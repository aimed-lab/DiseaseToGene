import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    // loadEnv reads .env files (local dev). On Vercel/CI there is no .env file —
    // build-time vars live in process.env. Merge both so SUPABASE_* resolve in
    // local dev AND production deploys.
    const fileEnv = loadEnv(mode, '.', '');
    const env = { ...fileEnv, ...process.env } as Record<string, string | undefined>;
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          ignored: ['**/wiki-vault/**', '**/.obsidian/**'],
        },
      },
      plugins: [react(), tailwindcss()],
      define: {
        // Supabase anon key is safe to expose in the browser (RLS protects data)
        'process.env.SUPABASE_URL':     JSON.stringify(env.SUPABASE_URL),
        'process.env.SUPABASE_ANON_KEY':JSON.stringify(env.SUPABASE_ANON_KEY),
        // GEMINI_API_KEY is intentionally NOT here. AI calls are server-side only.
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              'd3':       ['d3'],
              'recharts': ['recharts'],
              'docx':     ['docx', 'file-saver'],
              'react':    ['react', 'react-dom', 'react-markdown'],
              'icons':    ['lucide-react'],
              'supabase': ['@supabase/supabase-js'],
            },
          },
        },
      },
    };
});
