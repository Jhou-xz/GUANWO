import os
import httpx
from typing import Optional, Dict

WECHAT_TIMEOUT = 8.0

class WeChatConfig:
    def __init__(self, appid: str, secret: str):
        self.appid = appid
        self.secret = secret

def wechat_config_from_env() -> Optional[WeChatConfig]:
    appid = os.environ.get('WECHAT_APPID')
    secret = os.environ.get('WECHAT_SECRET')
    if appid and secret:
        return WeChatConfig(appid, secret)
    return None

def get_auth_url(appid: str, redirect_uri: str, state: str) -> str:
    params = {
        'appid': appid,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'snsapi_userinfo',
        'state': state
    }
    encoded = httpx.QueryParams(params)
    return f"https://open.weixin.qq.com/connect/oauth2/authorize?{encoded}#wechat_redirect"

async def exchange_user(cfg: WeChatConfig, code: str) -> Optional[Dict[str, str]]:
    params = {
        'appid': cfg.appid,
        'secret': cfg.secret,
        'code': code,
        'grant_type': 'authorization_code'
    }
    
    async with httpx.AsyncClient(timeout=WECHAT_TIMEOUT) as client:
        try:
            r = await client.get("https://api.weixin.qq.com/sns/oauth2/access_token", params=params)
            data = r.json()
        except Exception as e:
            print(f"[wechat] token request failed or timed out: {type(e).__name__}")
            return None

        access_token = data.get('access_token')
        openid = data.get('openid')
        if not access_token or not openid:
            print(f"[wechat] token exchange failed: {data.get('errcode')}, {data.get('errmsg')}")
            return None

        display_name = None
        unionid = data.get('unionid')
        try:
            user_params = {
                'access_token': access_token,
                'openid': openid,
                'lang': 'zh_CN'
            }
            ur = await client.get("https://api.weixin.qq.com/sns/userinfo", params=user_params)
            user_data = ur.json()
            display_name = user_data.get('nickname')
            unionid = unionid or user_data.get('unionid')
        except Exception:
            # Failure to get nickname is not fatal, openid is enough
            pass

        return {
            'openid': openid,
            'unionid': unionid,
            'display_name': display_name
        }
