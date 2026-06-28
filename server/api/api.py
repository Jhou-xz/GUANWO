import os
import uuid
import time
import json
import logging
from typing import List, Optional
from django.http import HttpResponse, HttpResponseRedirect
from django.db import transaction
from django.contrib.auth.hashers import make_password, check_password
from asgiref.sync import sync_to_async
from ninja import NinjaAPI, Schema

from api.models import User, Chart
from api.prompts import (
    build_messages,
    build_dream_messages,
    build_chat_messages,
    build_fortune_messages,
    build_analyze_messages,
    build_liuyao_messages,
)
from api.deepseek import relay_deepseek
from api.wechat import wechat_config_from_env, get_auth_url, exchange_user
from api.guard import get_ai_guard
from api.quota import get_quota_manager
from core.rate_limiter import get_client_ip
from core.exceptions import ComplianceViolation
from core.views import router as core_router

logger = logging.getLogger(__name__)

api = NinjaAPI(title="GuanWo API", version="1.0.0")
api.add_router("/", core_router)

guard = get_ai_guard()
quota_mgr = get_quota_manager()


def get_json_body_dict(request):
    if len(request.body) > 96 * 1024:
        raise ValueError("413")
    try:
        data = json.loads(request.body.decode('utf-8'))
        if not isinstance(data, dict):
            raise ValueError("400")
        return data
    except Exception:
        raise ValueError("400")


class RegisterRequest(Schema):
    username: str
    password: str


class LoginRequest(Schema):
    username: str
    password: str


class DevLoginRequest(Schema):
    name: Optional[str] = None
    openid: Optional[str] = None


class RechargeRequest(Schema):
    amount: float


class ChartSyncItem(Schema):
    id: str
    label: str
    chart: dict
    reading: Optional[str] = None
    ts: int


class ChartSyncRequest(Schema):
    charts: List[ChartSyncItem]


# ───────────── Auth & Account Sync Helpers ─────────────

def sync_dev_login(name, openid):
    if openid:
        user, created = User.objects.get_or_create(
            openid=openid,
            defaults={
                'id': str(uuid.uuid4()),
                'display_name': openid,
                'credits': 10,
                'created_at': int(time.time() * 1000)
            }
        )
    elif name:
        user, created = User.objects.get_or_create(
            openid="dev:" + name,
            defaults={
                'id': str(uuid.uuid4()),
                'display_name': name,
                'credits': 10,
                'created_at': int(time.time() * 1000)
            }
        )
    else:
        user, created = User.objects.get_or_create(
            openid="dev:default",
            defaults={
                'id': str(uuid.uuid4()),
                'display_name': "Default Dev User",
                'credits': 10,
                'created_at': int(time.time() * 1000)
            }
        )
    return user


def sync_register_user(username, password):
    if User.objects.filter(username=username).exists():
        raise ValueError("用户名已存在")
    user = User.objects.create(
        id=str(uuid.uuid4()),
        username=username,
        password_hash=make_password(password),
        display_name=username,
        credits=10,
        created_at=int(time.time() * 1000)
    )
    return user


def sync_login_user(username, password):
    try:
        user = User.objects.get(username=username)
        if check_password(password, user.password_hash):
            return user
    except User.DoesNotExist:
        pass
    return None


def sync_wechat_login_user(openid, unionid, display_name):
    user, created = User.objects.get_or_create(
        openid=openid,
        defaults={
            'id': str(uuid.uuid4()),
            'unionid': unionid,
            'display_name': display_name or openid,
            'credits': 10,
            'created_at': int(time.time() * 1000)
        }
    )
    if not created and (unionid or display_name):
        if unionid:
            user.unionid = unionid
        if display_name:
            user.display_name = display_name
        user.save()
    return user


def sync_chart_save(user_id, item_id, label, chart_json, reading, ts):
    with transaction.atomic():
        user = User.objects.get(id=user_id)
        chart, created = Chart.objects.get_or_create(
            user=user,
            fingerprint=item_id,
            defaults={
                'id': str(uuid.uuid4()),
                'label': label,
                'chart_json': chart_json,
                'reading': reading,
                'ts': ts
            }
        )
        if not created:
            if ts > chart.ts:
                chart.ts = ts
                chart.label = label
                chart.chart_json = chart_json
                if reading is not None and reading != '':
                    chart.reading = reading
                chart.save()
            elif ts == chart.ts:
                chart.label = label
                chart.chart_json = chart_json
                if reading is not None and reading != '':
                    chart.reading = reading
                chart.save()
            else:
                if (reading is not None and reading != '') and (chart.reading is None or chart.reading == ''):
                    chart.reading = reading
                    chart.save()


def sync_get_all_charts(user_id):
    charts_qs = Chart.objects.filter(user_id=user_id)
    ret = []
    for c in charts_qs:
        try:
            chart_obj = json.loads(c.chart_json)
            ret.append({
                "id": c.fingerprint,
                "label": c.label,
                "chart": chart_obj,
                "reading": c.reading,
                "ts": c.ts
            })
        except Exception:
            pass
    return ret


def sync_delete_user_account(user_id):
    with transaction.atomic():
        Chart.objects.filter(user_id=user_id).delete()
        User.objects.filter(id=user_id).delete()


def sync_deduct_credit(user_id: str) -> bool:
    try:
        with transaction.atomic():
            user = User.objects.select_for_update().get(id=user_id)
            if user.credits < 1:
                return False
            user.credits -= 1
            user.save()
            return True
    except User.DoesNotExist:
        return False


def _user_to_dict(user):
    return {
        "id": user.id,
        "openid": user.openid,
        "username": user.username,
        "displayName": user.display_name,
        "credits": user.credits,
    }


# ───────────── AI Helpers ─────────────

def _check_ai_quota(request, reading_type: str):
    """
    Enforce daily AI quota for anonymous users.
    Authenticated users still use the existing credits system for /chat.
    Other AI endpoints are free but rate-limited by middleware.
    """
    user = getattr(request, "gw_user", None)
    client_ip = get_client_ip(request)

    # Only enforce daily quota for anonymous users on non-chat endpoints
    if user is None and reading_type != "chat":
        allowed, info = quota_mgr.check_quota(user, client_ip)
        if not allowed:
            logger.warning(
                "Anonymous AI quota exceeded",
                extra={"client_ip_hash": client_ip, "reading_type": reading_type},
            )
            return HttpResponse(
                f"今日免费次数已用完（{info['limit']} 次），请登录或明日再试。",
                status=429,
                content_type="text/plain; charset=utf-8",
            )
        quota_mgr.consume_quota(user, client_ip)

    return None


def _validate_messages(messages: list, reading_type: str, chart_data: Optional[dict] = None):
    """Run compliance guard on prompt messages."""
    chart_json = json.dumps(chart_data, ensure_ascii=False) if chart_data else None
    result = guard.validate_messages(messages, reading_type=reading_type, chart_data=chart_json)
    if not result.is_allowed:
        logger.warning(
            "AI guard blocked request",
            extra={"rule": result.rule_violated, "reading_type": reading_type},
        )
        raise ComplianceViolation(result.reason, rule_violated=result.rule_violated)


# ───────────── Endpoints ─────────────

@api.get("/health")
def health(request):
    return {"ok": True}


@api.get("/me")
def me(request):
    user = getattr(request, "gw_user", None)
    wechat_configured = wechat_config_from_env() is not None

    if not user:
        return {"user": None, "wechat": wechat_configured}

    return {"user": _user_to_dict(user), "wechat": wechat_configured}


@api.post("/auth/dev")
def auth_dev(request, data: DevLoginRequest):
    user = sync_dev_login(data.name, data.openid)
    request.session['user_id'] = user.id
    return {"user": _user_to_dict(user)}


@api.post("/auth/register")
def auth_register(request, data: RegisterRequest):
    try:
        user = sync_register_user(data.username, data.password)
        request.session['user_id'] = user.id
        return {"user": _user_to_dict(user)}
    except ValueError as e:
        return HttpResponse(str(e), status=400, content_type="text/plain; charset=utf-8")


@api.post("/auth/login")
def auth_login(request, data: LoginRequest):
    user = sync_login_user(data.username, data.password)
    if not user:
        return HttpResponse("用户名或密码错误", status=401, content_type="text/plain; charset=utf-8")

    request.session['user_id'] = user.id
    return {"user": _user_to_dict(user)}


@api.post("/auth/logout")
def auth_logout(request):
    request.session.flush()
    return {"ok": True}


@api.post("/account/delete")
def account_delete(request):
    user = getattr(request, "gw_user", None)
    if not user:
        return HttpResponse("Unauthorized", status=401)

    sync_delete_user_account(user.id)
    request.session.flush()
    return {"ok": True}


@api.get("/charts")
def get_charts(request):
    user = getattr(request, "gw_user", None)
    if not user:
        return HttpResponse("Unauthorized", status=401)

    charts_list = sync_get_all_charts(user.id)
    return {"charts": charts_list}


@api.post("/charts/sync")
def sync_charts(request, data: ChartSyncRequest):
    user = getattr(request, "gw_user", None)
    if not user:
        return HttpResponse("Unauthorized", status=401)

    for item in data.charts:
        chart_json = json.dumps(item.chart)
        sync_chart_save(
            user.id, item.id, item.label, chart_json, item.reading, item.ts
        )

    charts_list = sync_get_all_charts(user.id)
    return {"charts": charts_list}


@api.post("/charts/delete")
def delete_chart(request):
    user = getattr(request, "gw_user", None)
    if not user:
        return HttpResponse("Unauthorized", status=401)

    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    chart_id = data.get("id")
    if not chart_id:
        return HttpResponse("Missing id", status=400)

    Chart.objects.filter(user_id=user.id, fingerprint=chart_id).delete()
    return {"ok": True}


@api.post("/credits/recharge")
def recharge_credits(request, data: RechargeRequest):
    user = getattr(request, "gw_user", None)
    if not user:
        return HttpResponse("Unauthorized", status=401)

    if data.amount <= 0:
        return HttpResponse("金额必须大于0", status=400, content_type="text/plain; charset=utf-8")

    user.credits += int(data.amount * 10)
    user.save()
    return {"ok": True, "credits": user.credits}


# ───────────── WeChat OAuth ─────────────

@api.get("/auth/wechat")
def auth_wechat(request):
    cfg = wechat_config_from_env()
    if not cfg:
        return HttpResponse("WeChat Login is not configured", status=500)

    state = str(uuid.uuid4())
    request.session['wechat_state'] = state

    redirect_uri = request.build_absolute_uri('/api/auth/wechat/callback')
    url = get_auth_url(cfg.appid, redirect_uri, state)
    return HttpResponseRedirect(url)


@api.get("/auth/wechat/callback")
async def auth_wechat_callback(request, code: str, state: str):
    stored_state = await sync_to_async(lambda: request.session.get('wechat_state'))()
    if not stored_state or stored_state != state:
        return HttpResponse("CSRF state check failed", status=403)

    cfg = wechat_config_from_env()
    if not cfg:
        return HttpResponse("WeChat Login is not configured", status=500)

    user_info = await exchange_user(cfg, code)
    if not user_info:
        return HttpResponse("WeChat auth failed", status=400)

    user = await sync_to_async(sync_wechat_login_user)(
        user_info['openid'], user_info['unionid'], user_info['display_name']
    )

    def set_user_session():
        request.session['user_id'] = user.id
    await sync_to_async(set_user_session)()

    return HttpResponseRedirect("/")


# ───────────── AI API Endpoints (Streaming) ─────────────

@api.post("/reading")
async def api_reading(request):
    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    if "元信息" not in data or "八字" not in data or "紫微" not in data:
        return HttpResponse("Missing chart data", status=400)

    try:
        messages = build_messages(data)
        _validate_messages(messages, "bazi", data)
    except ComplianceViolation as exc:
        return HttpResponse(exc.message, status=400, content_type="text/plain; charset=utf-8")
    except Exception:
        return HttpResponse("Malformed chart data", status=400)

    quota_resp = _check_ai_quota(request, "bazi")
    if quota_resp:
        return quota_resp

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return await relay_deepseek(api_key, messages, reading_type="bazi", user=getattr(request, "gw_user", None))


@api.post("/dream")
async def api_dream(request):
    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    history = data.get("messages")
    if not history or not isinstance(history, list) or len(history) == 0:
        return HttpResponse("Missing dream messages", status=400)

    if history[0].get("role") != "user" or not history[0].get("content"):
        return HttpResponse("Missing dream content", status=400)

    view = data.get("视角")
    chart = data.get("命盘")

    try:
        messages = build_dream_messages(history, view, chart)
        _validate_messages(messages, "dream", chart)
    except ComplianceViolation as exc:
        return HttpResponse(exc.message, status=400, content_type="text/plain; charset=utf-8")
    except Exception:
        return HttpResponse("Malformed request", status=400)

    quota_resp = _check_ai_quota(request, "dream")
    if quota_resp:
        return quota_resp

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return await relay_deepseek(api_key, messages, reading_type="dream", user=getattr(request, "gw_user", None))


@api.post("/fortune")
async def api_fortune(request):
    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    chart = data.get("命盘")
    ly = data.get("流年")
    if not chart or not ly:
        return HttpResponse("Missing chart or fortune year", status=400)

    try:
        messages = build_fortune_messages(chart, ly)
        _validate_messages(messages, "fortune", chart)
    except ComplianceViolation as exc:
        return HttpResponse(exc.message, status=400, content_type="text/plain; charset=utf-8")
    except Exception:
        return HttpResponse("Malformed request", status=400)

    quota_resp = _check_ai_quota(request, "fortune")
    if quota_resp:
        return quota_resp

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return await relay_deepseek(api_key, messages, reading_type="fortune", user=getattr(request, "gw_user", None))


@api.post("/analyze")
async def api_analyze(request):
    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    chart = data.get("命盘")
    system_type = data.get("系统")
    if not chart or not system_type:
        return HttpResponse("Missing chart or system type", status=400)

    try:
        messages = build_analyze_messages(chart, system_type)
        _validate_messages(messages, "analyze", chart)
    except ComplianceViolation as exc:
        return HttpResponse(exc.message, status=400, content_type="text/plain; charset=utf-8")
    except Exception:
        return HttpResponse("Malformed request", status=400)

    quota_resp = _check_ai_quota(request, "analyze")
    if quota_resp:
        return quota_resp

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return await relay_deepseek(api_key, messages, reading_type="analyze", user=getattr(request, "gw_user", None))


@api.post("/liuyao")
async def api_liuyao(request):
    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    卦 = data.get("卦")
    history = data.get("messages")
    if not 卦 or not isinstance(history, list):
        return HttpResponse("Missing 卦 or messages", status=400)

    if not 卦.get("问题") or 卦.get("问题").strip() == "":
        return HttpResponse("Missing question", status=400)

    try:
        messages = build_liuyao_messages(卦, history)
        _validate_messages(messages, "liu_yao", 卦)
    except ComplianceViolation as exc:
        return HttpResponse(exc.message, status=400, content_type="text/plain; charset=utf-8")
    except Exception:
        return HttpResponse("Malformed request", status=400)

    quota_resp = _check_ai_quota(request, "liu_yao")
    if quota_resp:
        return quota_resp

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return await relay_deepseek(api_key, messages, reading_type="liu_yao", user=getattr(request, "gw_user", None))


@api.post("/chat")
async def api_chat(request):
    user = getattr(request, "gw_user", None)
    if not user:
        return HttpResponse("Unauthorized", status=401)

    try:
        data = get_json_body_dict(request)
    except ValueError as e:
        return HttpResponse(str(e), status=int(str(e)))

    chart = data.get("命盘")
    reading = data.get("解读")
    history = data.get("messages")

    if not chart or not isinstance(history, list) or len(history) == 0:
        return HttpResponse("Missing chart or messages", status=400)

    try:
        messages = build_chat_messages(chart, reading, history)
        _validate_messages(messages, "chat", chart)
    except ComplianceViolation as exc:
        return HttpResponse(exc.message, status=400, content_type="text/plain; charset=utf-8")
    except Exception:
        return HttpResponse("Malformed request", status=400)

    has_credit = await sync_to_async(sync_deduct_credit)(user.id)
    if not has_credit:
        return HttpResponse("点数不足", status=402)

    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return await relay_deepseek(api_key, messages, reading_type="chat", user=user)
