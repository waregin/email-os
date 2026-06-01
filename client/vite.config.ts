import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy /api and /auth to the Express server so the browser sees
      // everything as localhost:5173 — no CORS, no credentials juggling.
      // NOTE: for OAuth to be fully same-origin, set GOOGLE_REDIRECT_URI in
      // your .env to http://localhost:5173/auth/callback (update Google
      // Cloud Console too). Until then, the cookie lands on :3001 and the
      // proxy only helps with API calls made AFTER the OAuth round-trip.
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
      '/auth': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
})
