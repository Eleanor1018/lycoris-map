import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from "node:path";
import * as fs from 'node:fs'

const certFile = process.env.VITE_HTTPS_CERT || path.resolve(__dirname, '.cert/localhost.pem')
const keyFile = process.env.VITE_HTTPS_KEY || path.resolve(__dirname, '.cert/localhost-key.pem')
const useHttps = fs.existsSync(certFile) && fs.existsSync(keyFile)
// Rust 本地默认后端监听 8080 且只绑定 IPv4；用 127.0.0.1 避免 localhost 解析成 ::1 而连不上。
// 需要时仍可用进程环境 VITE_BACKEND_URL 覆盖代理目标。
const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve:{
    alias: {
      '@': path.resolve(__dirname, 'src'),
    }
  },
  server: {
    https: useHttps
      ? {
          cert: fs.readFileSync(certFile),
          key: fs.readFileSync(keyFile),
        }
      : undefined,
    host: '0.0.0.0',
    proxy: {
      '/api':{
        target: backendTarget,
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
