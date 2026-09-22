# 夏水仙 · Lycoris

[简体中文](README.md) | [English](README.en.md)

夏水仙是一款简洁的地图，帮你找到无障碍卫生间、母婴室和医疗机构。我们希望把实用的无障碍设施信息带给每一个需要的人，让出门少一些顾虑。

**[打开地图 → lycoris-map.com](https://lycoris-map.com)**

Web 已可使用，原生 iOS 和 Android 应用正在测试中。

## 可以做什么

- **找附近的设施。** 在地图上浏览，按名称、类型或距离查找点位。
- **出发前多了解一点。** 查看照片、设施分类、开放时间和临近关门提醒。
- **留下常用的地方。** 登录后收藏点位，也可以分享给别人，或打开地图应用导航。
- **一起补全地图。** 添加新点位、提交更正或上传照片，审核通过后供大家查看。
- **按自己的习惯使用。** 支持中文和英文；Web 可切换 OSM、腾讯地图和天地图。

## 技术栈

| 部分       | 技术                                         |
| ---------- | -------------------------------------------- |
| 后端       | Rust · Axum · SQLx                           |
| Web        | React · TypeScript · Tailwind CSS            |
| iOS        | Swift · SwiftUI · MapKit                     |
| Android    | Kotlin · Jetpack Compose                     |
| 数据与存储 | PostgreSQL / PostGIS · Redis · Cloudflare R2 |

## 开发

```sh
git clone https://github.com/Eleanor1018/lycoris-map.git
cd lycoris-map
```

先按[后端说明](backend/README.md)启动本地 API，然后在另一个终端启动 Web：

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

开发页面位于 `http://127.0.0.1:5173`。Node、pnpm 和 Rust 版本由仓库配置固定。

- [Web 开发](frontend/README.md)
- [iOS 开发](apps/ios/README.md) · [Android 开发](apps/android/README.md)
- [项目架构](ARCHITECTURE.md)

## 许可

项目采用 [MIT License](LICENSE)。地图数据、地图服务和第三方素材遵循各自的许可，使用时请保留署名。
