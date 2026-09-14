#!/usr/bin/env python3
"""阶段 4 演练的真实 HTTP 业务流（纯标准库）。

分阶段执行，状态在 <work-dir>/artifacts/flow_state.json 里串联：
    java-baseline   Java（PG17 或 PG18）登录、建点、改点提案、审核、收藏
    rust-writes     Rust：注册新用户、改密、建点、译文审批、图片上传+审批、收藏、头像
    rollback-verify 回退 Java：用新密码登录、读 Rust 新增数据/媒体，再用 Java 写入验证 ID 序列
    db-final-verify 数据库大版本回退后，验证 Rust 新增数据与媒体仍可读

约束
    - 只连回环入口（由调用方 guard 校验）；不打印密码/Cookie/完整个人记录。
    - 业务 401 视为流程失败（需要登录处），不混入成功；上传使用合法中等大小合成图。
"""

from __future__ import annotations

import json
import hashlib
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any

import synthetic_media
import common

# 演练 Web Origin（必须与 compose 的 REHEARSAL_WEB_ORIGINS 一致，否则 Spring CORS 403）。
REHEARSAL_WEB_ORIGIN = "http://localhost:5198"

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


class FlowError(RuntimeError):
    """演练 HTTP 流程失败。"""


@dataclass
class Response:
    status: int
    body: bytes
    headers: dict[str, str]

    def json(self) -> Any:
        if not self.body:
            return None
        try:
            return json.loads(self.body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


@dataclass
class Client:
    base_url: str
    cookies: CookieJar = field(default_factory=CookieJar)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
    ) -> Response:
        url = self.base_url + path
        body = data
        request_headers = {
            "Origin": REHEARSAL_WEB_ORIGIN,
            "Referer": REHEARSAL_WEB_ORIGIN + "/",
            "Accept": "application/json, text/plain, */*",
        }
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        if headers:
            request_headers.update(headers)
        req = urllib.request.Request(url, data=body, method=method, headers=request_headers)
        try:
            with self._opener.open(req, timeout=timeout) as resp:
                return Response(
                    resp.status,
                    resp.read(),
                    {k.lower(): v for k, v in resp.headers.items()},
                )
        except urllib.error.HTTPError as exc:
            return Response(
                exc.code,
                exc.read(),
                {k.lower(): v for k, v in (exc.headers or {}).items()},
            )
        except urllib.error.URLError as exc:
            raise FlowError(f"入口不可达：{exc.reason}") from exc


def _expect(resp: Response, allowed: set[int], what: str) -> None:
    if resp.status not in allowed:
        # 不把响应体（可能含身份/记录）写入日志或报告，只报状态码。
        raise FlowError(f"{what} 期望状态 {sorted(allowed)}，实际 {resp.status}")


def _multipart_png(field_name: str, png: bytes, filename: str) -> tuple[bytes, str]:
    boundary = "----lycorisRehearsal" + uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    return head + png + tail, f"multipart/form-data; boundary={boundary}"


STATE_NAME = "flow_state.json"


def _load_state(work_dir: Path) -> dict[str, Any]:
    path = work_dir / "artifacts" / STATE_NAME
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def _save_state(work_dir: Path, state: dict[str, Any]) -> None:
    path = work_dir / "artifacts" / STATE_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )


def _login(client: Client, username: str, password: str) -> None:
    resp = client.request(
        "POST", "/api/login", json_body={"username": username, "password": password}
    )
    _expect(resp, {200}, f"登录 {username}")


def _admin_second_factor(client: Client, passcode: str) -> None:
    resp = client.request("POST", "/api/admin/verify", json_body={"passcode": passcode})
    _expect(resp, {200}, "管理员二次验证")


def _create_marker(client: Client, *, lat: float, lng: float, title: str) -> int:
    resp = client.request(
        "POST",
        "/api/markers",
        json_body={
            "lat": lat,
            "lng": lng,
            "category": "accessible_toilet",
            "title": title,
            "description": "rehearsal synthetic",
            "isPublic": True,
            "isActive": True,
        },
    )
    _expect(resp, {200}, "创建点位")
    data = resp.json() or {}
    marker_id = data.get("id")
    if not isinstance(marker_id, int):
        raise FlowError("创建点位响应缺少 id")
    return marker_id


def _submit_edit(
    client: Client, marker_id: int, *, title: str, description: str | None = None, language: str
) -> None:
    body: dict[str, Any] = {"title": title, "language": language}
    if description is not None:
        body["description"] = description
    resp = client.request("PATCH", f"/api/markers/{marker_id}", json_body=body)
    _expect(resp, {200}, f"提交 {language} 编辑/译文提案")


def _update_marker(client: Client, marker_id: int, new_title: str) -> None:
    _submit_edit(client, marker_id, title=new_title, language="zh")


def _approve_latest_edit(
    client_admin: Client, marker_id: int, *, language: str | None = None
) -> dict[str, Any]:
    resp = client_admin.request("GET", "/api/admin/markers/pending-edits")
    _expect(resp, {200}, "待审编辑列表")
    for item in resp.json() or []:
        if item.get("markerId") != marker_id:
            continue
        if language is not None and item.get("language") != language:
            continue
        proposal_id = item.get("id")
        approved = client_admin.request(
            "POST", f"/api/admin/markers/edit-proposals/{proposal_id}/approve"
        )
        _expect(approved, {200}, "审核编辑提案")
        return {
            "proposalId": int(proposal_id),
            "language": item.get("language"),
            "title": item.get("title"),
            "description": item.get("description"),
        }
    raise FlowError(f"未找到点位 {marker_id} 的待审编辑提案" + (f"（language={language}）" if language else ""))


def _favorite(client: Client, marker_id: int) -> None:
    resp = client.request("POST", f"/api/markers/{marker_id}/favorite")
    _expect(resp, {200}, "收藏点位")


def _get_marker(client: Client, marker_id: int) -> dict[str, Any]:
    resp = client.request("GET", f"/api/markers/{marker_id}")
    _expect(resp, {200}, f"读取点位 {marker_id}")
    return resp.json() or {}


def _get_marker_lang(client: Client, marker_id: int, lang: str) -> dict[str, Any]:
    resp = client.request("GET", f"/api/markers/{marker_id}?lang={lang}")
    _expect(resp, {200}, f"读取点位 {marker_id}?lang={lang}")
    return resp.json() or {}


def _me(client: Client) -> dict[str, Any]:
    resp = client.request("GET", "/api/me")
    _expect(resp, {200}, "读取 /api/me")
    data = resp.json() or {}
    return data.get("data") or {}


def _favorites(client: Client) -> list[int]:
    resp = client.request("GET", "/api/markers/me/favorites")
    _expect(resp, {200}, "读取收藏列表")
    payload = resp.json()
    if isinstance(payload, dict):
        payload = payload.get("data") or []
    ids: list[int] = []
    for item in payload or []:
        if isinstance(item, int):
            ids.append(item)
        elif isinstance(item, dict) and isinstance(item.get("id"), int):
            ids.append(item["id"])
    return ids


def _assert_marker_fields(detail: dict[str, Any], expected: dict[str, Any], *, where: str) -> None:
    for field in ("title", "description", "category", "sourceLanguage"):
        if field in expected and detail.get(field) != expected[field]:
            raise FlowError(
                f"{where} 点位 {expected.get('id')} 字段 {field} 不一致："
                f"{detail.get(field)!r} != {expected[field]!r}"
            )


def _upload_marker_image(client: Client, marker_id: int, png: bytes) -> None:
    body, content_type = _multipart_png("file", png, "rehearsal-marker.png")
    resp = client.request(
        "POST",
        f"/api/markers/{marker_id}/image",
        data=body,
        headers={"Content-Type": content_type},
    )
    _expect(resp, {200}, "上传点位图片")


def _approve_latest_image(client_admin: Client, marker_id: int) -> str:
    resp = client_admin.request("GET", "/api/admin/markers/pending-images")
    _expect(resp, {200}, "待审图片列表")
    for item in resp.json() or []:
        if item.get("markerId") == marker_id:
            proposal_id = item.get("id")
            approved = client_admin.request(
                "POST", f"/api/admin/markers/image-proposals/{proposal_id}/approve"
            )
            _expect(approved, {200}, "审核图片提案")
            url = item.get("imageUrl")
            if not isinstance(url, str):
                raise FlowError("图片提案缺少 imageUrl")
            return url
    raise FlowError(f"未找到点位 {marker_id} 的待审图片提案")


def _upload_avatar(client: Client, png: bytes) -> str:
    body, content_type = _multipart_png("file", png, "rehearsal-avatar.png")
    resp = client.request(
        "POST", "/api/me/avatar", data=body, headers={"Content-Type": content_type}
    )
    _expect(resp, {200}, "上传头像")
    data = resp.json() or {}
    payload = data.get("data") or {}
    url = payload.get("avatarUrl")
    if not isinstance(url, str):
        raise FlowError("头像响应缺少 avatarUrl")
    return url


def _read_upload(client: Client, url: str) -> dict[str, object]:
    resp = client.request("GET", url)
    _expect(resp, {200}, f"读取媒体 {url}")
    digest = hashlib.sha256(resp.body).hexdigest()
    return {"url": url, "sha256": digest, "bytes": len(resp.body)}


def _media_hashes(client: Client, urls: dict[str, str]) -> dict[str, dict[str, object]]:
    return {key: _read_upload(client, url) for key, url in urls.items() if url}


# --------------------------------------------------------------------------
# 阶段
# --------------------------------------------------------------------------


def _translation_row(marker_id: int, language: str, pg_user: str) -> dict[str, Any]:
    """只读证据：读取 PG18 up 上该点位译文的 id/source_hash（不写库）。"""
    spec = common.TABLES["pg18"]
    raw = common.psql(
        spec["container"],
        spec["database"],
        "SELECT id || '|' || source_hash FROM public.map_marker_translations "
        f"WHERE marker_id = {int(marker_id)} AND language = '{language}';",
        user=pg_user,
        check=False,
        timeout=15,
    ).strip()
    if "|" not in raw:
        raise FlowError(f"PG18 未找到 marker {marker_id} 的 {language} 译文行")
    row_id, _, source_hash = raw.partition("|")
    return {"id": int(row_id), "sourceHash": source_hash, "language": language}


def _phase_java_baseline(
    base_url: str, work_dir: Path, *, user_username: str, user_password: str,
    admin_username: str, admin_password: str, admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    user = Client(base_url)
    admin = Client(base_url)
    _login(user, user_username, user_password)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)
    stamp = str(int(time.time()))
    marker_id = _create_marker(
        user, lat=31.2305, lng=121.4738, title=f"Rehearsal Java baseline {stamp}"
    )
    new_title = f"Rehearsal Java baseline edited {stamp}"
    _update_marker(user, marker_id, new_title)
    proposal = _approve_latest_edit(admin, marker_id, language="zh")
    baseline = {
        "id": marker_id,
        "title": new_title,
        "description": "rehearsal synthetic",
        "category": "accessible_toilet",
        "sourceLanguage": "zh",
    }
    _assert_marker_fields(_get_marker(user, marker_id), baseline, where="Java(PG17)")
    _favorite(user, marker_id)
    if marker_id not in _favorites(user):
        raise FlowError("Java 基线收藏未写入")
    avatar_url = _upload_avatar(user, synthetic_media.png_bytes(64, 64, 24680))
    avatar_read = _read_upload(user, avatar_url)
    state.setdefault("markers", []).append({"phase": "java-baseline", **baseline})
    state["lastMarkerId"] = marker_id
    state["javaBaseline"] = {"avatarUrl": avatar_url, "avatarSha256": avatar_read["sha256"]}
    return {
        "createdMarkerId": marker_id,
        "approvedEditProposalId": proposal["proposalId"],
        "titleVerified": True,
        "favoriteVerified": True,
        "avatar": avatar_read,
    }


def _phase_java_pg18(
    base_url: str, work_dir: Path, *, user_username: str, user_password: str,
    admin_username: str, admin_password: str, admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    """Java 在 PG18（升级后）继续读写：读回 PG17 阶段数据 + 新写入验证 ID 序列。"""
    user = Client(base_url)
    admin = Client(base_url)
    _login(user, user_username, user_password)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)
    baseline = [m for m in state.get("markers", []) if m.get("phase") == "java-baseline"]
    if not baseline:
        raise FlowError("缺少 Java 基线阶段创建的点位状态")
    for item in baseline:
        _assert_marker_fields(_get_marker(user, item["id"]), item, where="Java(PG18)")
        if item["id"] not in _favorites(user):
            raise FlowError(f"PG18 读回的 PG17 收藏丢失：{item['id']}")
    stamp = str(int(time.time()))
    marker_id = _create_marker(
        user, lat=31.2309, lng=121.4742, title=f"Rehearsal Java PG18 {stamp}"
    )
    last = state.get("lastMarkerId") or 0
    if marker_id <= last:
        raise FlowError(f"PG18 阶段 ID 序列未推进：新 id {marker_id} <= {last}")
    new_title = f"Rehearsal Java PG18 edited {stamp}"
    _update_marker(user, marker_id, new_title)
    proposal = _approve_latest_edit(admin, marker_id, language="zh")
    expected = {
        "id": marker_id,
        "title": new_title,
        "description": "rehearsal synthetic",
        "category": "accessible_toilet",
        "sourceLanguage": "zh",
    }
    _assert_marker_fields(_get_marker(user, marker_id), expected, where="Java(PG18)")
    _favorite(user, marker_id)
    if marker_id not in _favorites(user):
        raise FlowError("PG18 收藏未写入")
    avatar_url = _upload_avatar(user, synthetic_media.png_bytes(64, 64, 24681))
    avatar_read = _read_upload(user, avatar_url)
    baseline_avatar = state.get("javaBaseline", {})
    baseline_read = None
    if baseline_avatar.get("avatarUrl"):
        baseline_read = _read_upload(user, baseline_avatar["avatarUrl"])
        if baseline_read["sha256"] != baseline_avatar.get("avatarSha256"):
            raise FlowError("PG18 读回的 PG17 头像 sha256 不一致")
    state["markers"].append({"phase": "java-pg18", **expected})
    state["lastMarkerId"] = marker_id
    return {
        "pg17MarkersReadable": len(baseline),
        "createdMarkerId": marker_id,
        "approvedEditProposalId": proposal["proposalId"],
        "idSequenceAdvanced": True,
        "avatar": avatar_read,
        "pg17AvatarReadable": bool(baseline_read),
    }


def _phase_rust_writes(
    base_url: str, work_dir: Path, *, pg_user: str,
    admin_username: str, admin_password: str, admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    admin = Client(base_url)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)

    # 1) 注册新用户并改密（后续 Java 真实登录证明 BCrypt 兼容）
    stamp = str(int(time.time()))
    new_username = f"rehearsal_new_{stamp}"
    new_password_initial = "RehearsalNewInit1!"
    new_password = "RehearsalNewChanged2!"
    user = Client(base_url)
    resp = user.request(
        "POST",
        "/api/register",
        json_body={
            "username": new_username,
            "nickname": "Rehearsal New",
            "email": f"{new_username}@example.invalid",
            "password": new_password_initial,
        },
    )
    _expect(resp, {200}, "注册新用户")
    new_public_id = ((resp.json() or {}).get("data") or {}).get("publicId")
    if not new_public_id:
        raise FlowError("注册响应缺少 publicId")
    change = user.request(
        "POST",
        "/api/me/password",
        json_body={"oldPassword": new_password_initial, "newPassword": new_password},
    )
    _expect(change, {200}, "Rust 改密")
    user = Client(base_url)
    _login(user, new_username, new_password)

    # 2) 建点：源语言 zh；先做原文(zh)编辑审批
    marker_id = _create_marker(
        user, lat=31.2315, lng=121.4748, title=f"Rehearsal Rust marker {stamp}"
    )
    zh_title = f"Rehearsal Rust marker edited {stamp}"
    _submit_edit(user, marker_id, title=zh_title, language="zh")
    zh_proposal = _approve_latest_edit(admin, marker_id, language="zh")
    rust_marker = {
        "id": marker_id,
        "title": zh_title,
        "description": "rehearsal synthetic",
        "category": "accessible_toilet",
        "sourceLanguage": "zh",
    }
    _assert_marker_fields(_get_marker(user, marker_id), rust_marker, where="Rust(zh)")

    # 3) 真实新增 en 译文提案并审批
    en_title = f"Rehearsal Rust EN {stamp}"
    en_desc = f"English translation for rehearsal {stamp}"
    _submit_edit(user, marker_id, title=en_title, description=en_desc, language="en")
    en_proposal = _approve_latest_edit(admin, marker_id, language="en")
    en_detail = _get_marker_lang(user, marker_id, "en")
    if en_detail.get("title") != en_title or en_detail.get("description") != en_desc:
        raise FlowError("Rust en 译文读取内容不一致")
    zh_detail = _get_marker_lang(user, marker_id, "zh")
    _assert_marker_fields(zh_detail, rust_marker, where="Rust(zh-after-en)")
    translation_row = _translation_row(marker_id, "en", pg_user)

    # 4) 图片上传 + 管理员审批；严格核对点位 markImage 等于已审批 URL
    png = synthetic_media.png_bytes(512, 512, 424242)
    _upload_marker_image(user, marker_id, png)
    image_url = _approve_latest_image(admin, marker_id)
    if _get_marker(user, marker_id).get("markImage") != image_url:
        raise FlowError("Rust 审批后 markImage 与图片提案 URL 不一致")
    image_read = _read_upload(user, image_url)

    # 5) 显式收藏（不再夹带在图片上传里）
    _favorite(user, marker_id)
    if marker_id not in _favorites(user):
        raise FlowError("Rust 收藏未写入或未出现在收藏列表")

    # 6) 头像上传，并严格核对 /api/me 返回刚上传的 URL
    avatar_url = _upload_avatar(user, synthetic_media.png_bytes(64, 64, 13579))
    avatar_read = _read_upload(user, avatar_url)
    me = _me(user)
    if me.get("publicId") != new_public_id or me.get("avatarUrl") != avatar_url:
        raise FlowError("Rust /api/me publicId/avatarUrl 与新建用户/刚上传不一致")

    state["newUser"] = {"username": new_username, "password": new_password, "publicId": new_public_id}
    state["rustMarker"] = rust_marker
    state["translation"] = {
        "language": "en",
        "title": en_title,
        "description": en_desc,
        "proposalId": en_proposal["proposalId"],
        "translationId": translation_row["id"],
        "sourceHash": translation_row["sourceHash"],
    }
    state["media"] = {"markerImageUrl": image_url, "avatarUrl": avatar_url}
    state["mediaHashes"] = {
        "markerImageSha256": image_read["sha256"],
        "avatarSha256": avatar_read["sha256"],
    }
    state["favoriteMarkerId"] = marker_id
    state["markers"].append({"phase": "rust-writes", **rust_marker})
    state["lastMarkerId"] = marker_id
    return {
        "newUserPublicId": new_public_id,
        "createdMarkerId": marker_id,
        "zhEditProposalId": zh_proposal["proposalId"],
        "enTranslationProposalId": en_proposal["proposalId"],
        "enTranslationId": translation_row["id"],
        "enTranslationSourceHash": translation_row["sourceHash"],
        "enTitle": en_title,
        "zhTitle": zh_title,
        "favoriteVerified": True,
        "meVerified": True,
        "markerImage": image_read,
        "avatar": avatar_read,
        "uploadedPngSha256": hashlib.sha256(png).hexdigest(),
    }


def _required_media(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    media = state.get("media") or {}
    hashes = state.get("mediaHashes") or {}
    for url_key, hash_key in (
        ("avatarUrl", "avatarSha256"),
        ("markerImageUrl", "markerImageSha256"),
    ):
        if not media.get(url_key) or not hashes.get(hash_key):
            raise FlowError(f"缺少 Rust 媒体状态 {url_key}/{hash_key}，拒绝少查")
    return media, hashes


def _assert_media_refs(
    zh_detail: dict[str, Any], me: dict[str, Any], media: dict[str, Any], *, where: str
) -> None:
    if me.get("avatarUrl") != media.get("avatarUrl"):
        raise FlowError(f"{where} /api/me avatarUrl 与记录不一致：{me.get('avatarUrl')!r}")
    if zh_detail.get("markImage") != media.get("markerImageUrl"):
        raise FlowError(f"{where} markImage 与已审批图片 URL 不一致：{zh_detail.get('markImage')!r}")


def _verify_rust_writes(client: Client, state: dict[str, Any], *, where: str) -> dict[str, Any]:
    """在目标后端上用真实 HTTP 核对 Rust 新建用户/点位/译文/收藏/媒体。"""
    new_user = state.get("newUser") or {}
    rust_marker = state.get("rustMarker") or {}
    translation = state.get("translation") or {}
    if not (new_user.get("username") and rust_marker.get("id") and translation.get("language")):
        raise FlowError("缺少 Rust 阶段写入状态")
    media, media_hashes = _required_media(state)

    _login(client, new_user["username"], new_user["password"])  # 真实登录验证 BCrypt 兼容
    me = _me(client)
    if me.get("publicId") != new_user["publicId"]:
        raise FlowError(f"{where} /api/me publicId 与 Rust 新建用户不一致")
    zh_detail = _get_marker_lang(client, rust_marker["id"], "zh")
    _assert_marker_fields(zh_detail, rust_marker, where=f"{where}(zh)")
    _assert_media_refs(zh_detail, me, media, where=where)
    en_detail = _get_marker_lang(client, rust_marker["id"], "en")
    if en_detail.get("title") != translation["title"] or en_detail.get("description") != translation["description"]:
        raise FlowError(f"{where} en 译文内容与 Rust 写入不一致")
    favorites = _favorites(client)
    if rust_marker["id"] not in favorites:
        raise FlowError(f"{where} 收藏列表缺少 Rust 点位 {rust_marker['id']}")

    verified = {}
    for key, url_key, hash_key in (
        ("avatar", "avatarUrl", "avatarSha256"),
        ("markerImage", "markerImageUrl", "markerImageSha256"),
    ):
        read = _read_upload(client, media[url_key])
        if read["sha256"] != media_hashes[hash_key]:
            raise FlowError(f"{where} {key} sha256 与 Rust 写入不一致")
        verified[key] = read
    return {
        "mePublicId": me.get("publicId"),
        "meAvatarUrl": me.get("avatarUrl"),
        "zhTitle": rust_marker["title"],
        "zhMarkImage": zh_detail.get("markImage"),
        "enTitle": en_detail.get("title"),
        "enDescription": en_detail.get("description"),
        "favoriteIds": favorites,
        "verifiedMedia": verified,
    }


def _continue_java_write(
    user: Client, admin: Client, state: dict[str, Any], *, phase: str, lat: float, lng: float
) -> int:
    stamp = str(int(time.time()))
    marker_id = _create_marker(user, lat=lat, lng=lng, title=f"Rehearsal Java {phase} {stamp}")
    last = state.get("lastMarkerId") or 0
    if marker_id <= last:
        raise FlowError(f"{phase} ID 序列未推进：新 id {marker_id} <= {last}")
    new_title = f"Rehearsal Java {phase} edited {stamp}"
    _submit_edit(user, marker_id, title=new_title, language="zh")
    _approve_latest_edit(admin, marker_id, language="zh")
    expected = {
        "id": marker_id,
        "title": new_title,
        "description": "rehearsal synthetic",
        "category": "accessible_toilet",
        "sourceLanguage": "zh",
    }
    _assert_marker_fields(_get_marker(user, marker_id), expected, where=phase)
    _favorite(user, marker_id)
    if marker_id not in _favorites(user):
        raise FlowError(f"{phase} 收藏未写入")
    state["markers"].append({"phase": phase, **expected})
    state["lastMarkerId"] = marker_id
    return marker_id


def _phase_rollback_verify(
    base_url: str, work_dir: Path, *, admin_username: str, admin_password: str,
    admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    user = Client(base_url)
    verified = _verify_rust_writes(user, state, where="Java(PG18)")
    admin = Client(base_url)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)
    marker_id = _continue_java_write(user, admin, state, phase="rollback-verify", lat=31.2325, lng=121.4758)
    return {
        "passwordChangePersisted": True,
        "rustWritesVerified": verified,
        "javaWriteMarkerId": marker_id,
        "idSequenceAdvanced": True,
    }


def _phase_db_final_verify(
    base_url: str, work_dir: Path, *, admin_username: str, admin_password: str,
    admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    """Java(PG17 back) 真实登录 Rust 改密账号并核对 Rust 全部写入，再继续写入。"""
    user = Client(base_url)
    verified = _verify_rust_writes(user, state, where="Java(PG17-back)")
    admin = Client(base_url)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)
    marker_id = _continue_java_write(user, admin, state, phase="db-final-verify", lat=31.2335, lng=121.4768)
    return {
        "rustUserLoginOk": True,
        "rustWritesVerified": verified,
        "javaWriteMarkerId": marker_id,
        "idSequenceAdvanced": True,
    }


def run_phase(
    *,
    phase: str,
    base_url: str,
    work_dir: Path,
    pg_user: str,
    admin_username: str,
    admin_password: str,
    admin_second: str,
    user_username: str,
    user_password: str,
) -> dict[str, Any]:
    state = _load_state(work_dir)
    state.setdefault("markers", [])
    if phase == "java-baseline":
        result = _phase_java_baseline(
            base_url, work_dir, user_username=user_username, user_password=user_password,
            admin_username=admin_username, admin_password=admin_password,
            admin_second=admin_second, state=state,
        )
    elif phase == "java-pg18":
        result = _phase_java_pg18(
            base_url, work_dir, user_username=user_username, user_password=user_password,
            admin_username=admin_username, admin_password=admin_password,
            admin_second=admin_second, state=state,
        )
    elif phase == "rust-writes":
        result = _phase_rust_writes(
            base_url, work_dir, pg_user=pg_user,
            admin_username=admin_username, admin_password=admin_password,
            admin_second=admin_second, state=state,
        )
    elif phase == "rollback-verify":
        result = _phase_rollback_verify(
            base_url, work_dir, admin_username=admin_username, admin_password=admin_password,
            admin_second=admin_second, state=state,
        )
    elif phase == "db-final-verify":
        result = _phase_db_final_verify(
            base_url, work_dir, admin_username=admin_username, admin_password=admin_password,
            admin_second=admin_second, state=state,
        )
    else:
        raise FlowError(f"未知阶段：{phase}")
    _save_state(work_dir, state)
    return result
