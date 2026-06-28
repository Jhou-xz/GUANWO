import json
import time
import httpx
import logging
from django.conf import settings
from django.http import HttpResponse, StreamingHttpResponse
from api.compliance import Redactor
from api.guard import get_ai_guard

logger = logging.getLogger(__name__)

guard = get_ai_guard()


async def relay_deepseek(
    api_key: str,
    messages: list,
    temperature: float = 0.85,
    max_tokens: int = 900,
    reading_type: str = "general",
    user=None,
):
    if not api_key:
        return HttpResponse("ApiKey not configured", status=500)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    payload = {
        "model": "deepseek-chat",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }

    start_time = time.time()
    prompt_text = json.dumps(messages, ensure_ascii=False)
    user_id = str(user.id) if user else "anonymous"

    client = httpx.AsyncClient(timeout=45.0)
    try:
        req = client.build_request(
            "POST", "https://api.deepseek.com/chat/completions",
            headers=headers, json=payload
        )
        response = await client.send(req, stream=True)
        if response.status_code != 200:
            logger.error(f"[relay] Upstream returned status {response.status_code}")
            await response.aclose()
            await client.aclose()
            return HttpResponse(f"服务出错（{response.status_code}）", status=502)
    except httpx.TimeoutException:
        await client.aclose()
        return HttpResponse("上游暂时不可用或超时，请重试。", status=504)
    except Exception:
        await client.aclose()
        return HttpResponse("上游暂时不可用或超时，请重试。", status=504)

    async def stream_generator():
        redactor = Redactor()
        full_response = []
        buffer = ""
        try:
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line_stripped = line.strip()
                    if not line_stripped:
                        continue
                    if not line_stripped.startswith("data:"):
                        continue
                    data_content = line_stripped[5:].strip()
                    if data_content == "[DONE]":
                        continue
                    try:
                        data_json = json.loads(data_content)
                        content = data_json.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if content:
                            purified = redactor.push(content)
                            if purified:
                                full_response.append(purified)
                                yield purified
                    except Exception:
                        pass

            tail = redactor.flush()
            if tail:
                full_response.append(tail)
                yield tail

            complete_text = "".join(full_response)
            sanitized = guard.sanitize_output(complete_text)
            final_text = guard.add_compliance_wrapper(sanitized, reading_type)

            # Audit log the completed interaction
            duration_ms = round((time.time() - start_time) * 1000, 2)
            guard.log_audit_entry(
                user_id=user_id,
                prompt=prompt_text,
                output=final_text,
                model="deepseek-chat",
                reading_type=reading_type,
                duration_ms=duration_ms,
            )

        except Exception as e:
            logger.error(f"[relay] Error during streaming: {type(e).__name__}")
            yield "\n\n（生成被中断了，请重试）"
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingHttpResponse(
        stream_generator(),
        content_type="text/plain; charset=utf-8",
        headers={"X-Accel-Buffering": "no"},
    )
