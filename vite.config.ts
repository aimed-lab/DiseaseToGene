import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
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
        // GEMINI_API_KEY and NVIDIA_API_KEY are intentionally NOT here —
        // all AI calls go through /api/ai/generate (server-side only)
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
            },
          },
        },
      },
    };
});
