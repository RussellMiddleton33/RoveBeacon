import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    basicSsl() // Generates self-signed certificate for HTTPS
  ],
  base: process.env.BASE_URL || '/',
  server: {
    host: true // Expose to network
  }
})
