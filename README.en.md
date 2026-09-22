# Lycoris

[简体中文](README.md) | [English](README.en.md)

Lycoris is a simple map for finding accessible toilets, nursing rooms, and medical institutions. We want useful information about accessible facilities to reach anyone who needs it, making it a little easier to go out.

**[Open the map → lycoris-map.com](https://lycoris-map.com)**

The Web app is available now. Native iOS and Android apps are in testing.

## What you can do

- **Find facilities nearby.** Browse the map or look for places by name, type, or distance.
- **Know more before you go.** Check photos, facility labels, opening hours, and closing-soon reminders.
- **Keep useful places handy.** Save bookmarks after signing in. Share a place or open a navigation app when you need directions.
- **Help improve the map.** Add places, suggest corrections, or upload photos. Contributions become public after review.
- **Make it yours.** Use English or Chinese. On the Web, choose OSM, Tencent Maps, or Tianditu.

## Technology

| Part             | Built with                                   |
| ---------------- | -------------------------------------------- |
| Backend          | Rust · Axum · SQLx                           |
| Web              | React · TypeScript · Tailwind CSS            |
| iOS              | Swift · SwiftUI · MapKit                     |
| Android          | Kotlin · Jetpack Compose                     |
| Data and storage | PostgreSQL / PostGIS · Redis · Cloudflare R2 |

## Development

```sh
git clone https://github.com/Eleanor1018/lycoris-map.git
cd lycoris-map
```

Start the local API using the [backend guide](backend/README.md), then open another terminal for the Web app:

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

The development site runs at `http://127.0.0.1:5173`. Node, pnpm, and Rust versions are pinned in the repository.

- [Web development](frontend/README.md)
- [iOS development](apps/ios/README.md) · [Android development](apps/android/README.md)
- [Architecture](ARCHITECTURE.md)

## License

The project uses the [MIT License](LICENSE). Map data, map services, and third-party assets retain their own licenses and attribution requirements.
