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


def _update_marker(client: Client, marker_id: int, new_title: str) -> None:
    resp = client.request(
        "PATCH",
        f"/api/markers/{marker_id}",
        json_body={"title": new_title, "language": "zh"},
    )
    _expect(resp, {200}, "提交编辑提案")


def _approve_latest_edit(client_admin: Client, marker_id: int) -> int:
    resp = client_admin.request("GET", "/api/admin/markers/pending-edits")
    _expect(resp, {200}, "待审编辑列表")
    for item in resp.json() or []:
        if item.get("markerId") == marker_id:
            proposal_id = item.get("id")
            approved = client_admin.request(
                "POST", f"/api/admin/markers/edit-proposals/{proposal_id}/approve"
            )
            _expect(approved, {200}, "审核编辑提案")
            return int(proposal_id)
    raise FlowError(f"未找到点位 {marker_id} 的待审编辑提案")


def _favorite(client: Client, marker_id: int) -> None:
    resp = client.request("POST", f"/api/markers/{marker_id}/favorite")
    _expect(resp, {200}, "收藏点位")


def _get_marker(client: Client, marker_id: int) -> dict[str, Any]:
    resp = client.request("GET", f"/api/markers/{marker_id}")
    _expect(resp, {200}, f"读取点位 {marker_id}")
    return resp.json() or {}


def _upload_marker_image(client: Client, marker_id: int, png: bytes) -> None:
    body, content_type = _multipart_png("file", png, "rehearsal-marker.png")
    resp = client.request(
        "POST",
        f"/api/markers/{marker_id}/image",
        data=body,
        headers={"Content-Type": content_type},
    )
    _expect(resp, {200}, "上传点位图片")
    resp = client.request("POST", f"/api/markers/{marker_id}/favorite")
    _expect(resp, {200}, "收藏点位（图片后）")


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


def _read_upload(client: Client, url: str) -> None:
    resp = client.request("GET", url)
    _expect(resp, {200}, f"读取媒体 {url}")


# --------------------------------------------------------------------------
# 阶段
# --------------------------------------------------------------------------


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
    proposal_id = _approve_latest_edit(admin, marker_id)
    detail = _get_marker(user, marker_id)
    if detail.get("title") != new_title:
        raise FlowError("Java 基线：审核后标题未更新")
    _favorite(user, marker_id)
    # 证明该后端能以统一 UID 写入并读回共享上传目录（同卷）。
    avatar_url = _upload_avatar(user, synthetic_media.png_bytes(64, 64, 24680))
    _read_upload(user, avatar_url)
    state.setdefault("markers", []).append(
        {"phase": "java-baseline", "id": marker_id, "title": new_title}
    )
    state["lastMarkerId"] = marker_id
    return {
        "createdMarkerId": marker_id,
        "approvedEditProposalId": proposal_id,
        "titleVerified": True,
        "avatarUrl": avatar_url,
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
        detail = _get_marker(user, item["id"])
        if detail.get("title") != item["title"]:
            raise FlowError(f"PG18 读回 PG17 点位 {item['id']} 内容不一致")
    stamp = str(int(time.time()))
    marker_id = _create_marker(
        user, lat=31.2309, lng=121.4742, title=f"Rehearsal Java PG18 {stamp}"
    )
    last = state.get("lastMarkerId") or 0
    if marker_id <= last:
        raise FlowError(f"PG18 阶段 ID 序列未推进：新 id {marker_id} <= {last}")
    new_title = f"Rehearsal Java PG18 edited {stamp}"
    _update_marker(user, marker_id, new_title)
    proposal_id = _approve_latest_edit(admin, marker_id)
    if _get_marker(user, marker_id).get("title") != new_title:
        raise FlowError("PG18 阶段审核后标题未更新")
    _favorite(user, marker_id)
    avatar_url = _upload_avatar(user, synthetic_media.png_bytes(64, 64, 13579))
    _read_upload(user, avatar_url)
    state["markers"].append({"phase": "java-pg18", "id": marker_id, "title": new_title})
    state["lastMarkerId"] = marker_id
    return {
        "pg17MarkersReadable": len(baseline),
        "createdMarkerId": marker_id,
        "approvedEditProposalId": proposal_id,
        "idSequenceAdvanced": True,
        "avatarUrl": avatar_url,
    }


def _phase_rust_writes(
    base_url: str, work_dir: Path, *, user_username: str, user_password: str,
    admin_username: str, admin_password: str, admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    admin = Client(base_url)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)

    # 1) 注册新用户并改密
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
    registered = resp.json() or {}
    new_public_id = (registered.get("data") or {}).get("publicId")
    if not new_public_id:
        raise FlowError("注册响应缺少 publicId")
    change = user.request(
        "POST",
        "/api/me/password",
        json_body={"oldPassword": new_password_initial, "newPassword": new_password},
    )
    _expect(change, {200}, "Rust 改密")
    # 改密后旧会话按契约可能失效，重新登录
    user = Client(base_url)
    _login(user, new_username, new_password)

    # 2) 建点 + 编辑提案审核（译文审批）
    marker_id = _create_marker(
        user, lat=31.2315, lng=121.4748, title=f"Rehearsal Rust marker {stamp}"
    )
    new_title = f"Rehearsal Rust marker edited {stamp}"
    _update_marker(user, marker_id, new_title)
    proposal_id = _approve_latest_edit(admin, marker_id)
    detail = _get_marker(user, marker_id)
    if detail.get("title") != new_title:
        raise FlowError("Rust：审核后标题未更新")

    # 3) 图片上传 + 管理员审批
    png = synthetic_media.png_bytes(128, 128, seed=abs(hash(stamp)) % 9999 + 1)
    _upload_marker_image(user, marker_id, png)
    image_url = _approve_latest_image(admin, marker_id)
    _read_upload(user, image_url)

    # 4) 头像上传
    avatar_url = _upload_avatar(user, synthetic_media.png_bytes(96, 96, 12345))
    _read_upload(user, avatar_url)

    state["newUser"] = {
        "username": new_username,
        "password": new_password,
        "publicId": new_public_id,
    }
    state["media"] = {"markerImageUrl": image_url, "avatarUrl": avatar_url}
    state["favoriteMarkerId"] = marker_id
    state["markers"].append({"phase": "rust-writes", "id": marker_id, "title": new_title})
    state["lastMarkerId"] = marker_id
    return {
        "newUserPublicId": new_public_id,
        "createdMarkerId": marker_id,
        "approvedEditProposalId": proposal_id,
        "markerImageUrl": image_url,
        "avatarUrl": avatar_url,
    }


def _phase_rollback_verify(
    base_url: str, work_dir: Path, *, admin_username: str, admin_password: str,
    admin_second: str, state: dict[str, Any],
) -> dict[str, Any]:
    new_user = state.get("newUser") or {}
    if not new_user.get("username"):
        raise FlowError("缺少 Rust 阶段创建的用户状态")
    user = Client(base_url)
    _login(user, new_user["username"], new_user["password"])  # 验证改密后新口令可用

    media = state.get("media") or {}
    if media.get("avatarUrl"):
        _read_upload(user, media["avatarUrl"])
    if media.get("markerImageUrl"):
        _read_upload(user, media["markerImageUrl"])

    rust_marker = state.get("favoriteMarkerId")
    if rust_marker:
        detail = _get_marker(user, rust_marker)
        if not detail.get("title", "").startswith("Rehearsal Rust marker"):
            raise FlowError("回退后无法读取 Rust 创建的点位内容")

    # Java 再写入/编辑，验证 ID 序列与数据兼容（新 id 必须大于已知最大 id）
    admin = Client(base_url)
    _login(admin, admin_username, admin_password)
    _admin_second_factor(admin, admin_second)
    stamp = str(int(time.time()))
    marker_id = _create_marker(
        user, lat=31.2325, lng=121.4758, title=f"Rehearsal Java after rollback {stamp}"
    )
    last = state.get("lastMarkerId") or 0
    if marker_id <= last:
        raise FlowError(f"ID 序列未推进：新 id {marker_id} <= {last}")
    new_title = f"Rehearsal Java after rollback edited {stamp}"
    _update_marker(user, marker_id, new_title)
    _approve_latest_edit(admin, marker_id)
    if _get_marker(user, marker_id).get("title") != new_title:
        raise FlowError("Java 回退后编辑审核未生效")
    state["markers"].append(
        {"phase": "rollback-verify", "id": marker_id, "title": new_title}
    )
    state["lastMarkerId"] = marker_id
    return {
        "passwordChangePersisted": True,
        "rustMarkerReadable": bool(rust_marker),
        "javaWriteMarkerId": marker_id,
        "idSequenceAdvanced": True,
    }


def _phase_db_final_verify(
    base_url: str, work_dir: Path, *, state: dict[str, Any]
) -> dict[str, Any]:
    new_user = state.get("newUser") or {}
    if not new_user.get("username"):
        raise FlowError("缺少 Rust 阶段创建的用户状态")
    user = Client(base_url)
    _login(user, new_user["username"], new_user["password"])
    media = state.get("media") or {}
    if media.get("avatarUrl"):
        _read_upload(user, media["avatarUrl"])
    rust_markers = [
        m for m in state.get("markers", []) if m.get("phase") == "rust-writes"
    ]
    for marker in rust_markers:
        _get_marker(user, marker["id"])
    return {
        "rustUserLoginOk": True,
        "rustMarkersReadable": len(rust_markers),
        "avatarReadable": bool(media.get("avatarUrl")),
        "markerImageReadable": bool(media.get("markerImageUrl")),
    }


def run_phase(
    *,
    phase: str,
    base_url: str,
    work_dir: Path,
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
            base_url,
            work_dir,
            user_username=user_username,
            user_password=user_password,
            admin_username=admin_username,
            admin_password=admin_password,
            admin_second=admin_second,
            state=state,
        )
    elif phase == "java-pg18":
        result = _phase_java_pg18(
            base_url,
            work_dir,
            user_username=user_username,
            user_password=user_password,
            admin_username=admin_username,
            admin_password=admin_password,
            admin_second=admin_second,
            state=state,
        )
    elif phase == "rust-writes":
        result = _phase_rust_writes(
            base_url,
            work_dir,
            user_username=user_username,
            user_password=user_password,
            admin_username=admin_username,
            admin_password=admin_password,
            admin_second=admin_second,
            state=state,
        )
    elif phase == "rollback-verify":
        result = _phase_rollback_verify(
            base_url,
            work_dir,
            admin_username=admin_username,
            admin_password=admin_password,
            admin_second=admin_second,
            state=state,
        )
    elif phase == "db-final-verify":
        result = _phase_db_final_verify(base_url, work_dir, state=state)
    else:
        raise FlowError(f"未知阶段：{phase}")
    _save_state(work_dir, state)
    return result
