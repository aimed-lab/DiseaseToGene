import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'child_process';

// The wiki's NARRATIVE layer (wiki/**/*.md) is versioned by app commit, while its DATA layer
// is versioned by snapshot id; every wiki page shows both. Vercel exposes the SHA as env.
const gitCommit = (): string => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
};

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
        '__GIT_COMMIT__': JSON.stringify(gitCommit()),
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
