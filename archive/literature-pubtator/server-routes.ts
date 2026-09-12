// REFERENCE COPY (still live in server.ts): the PubTator proxy and /api/pubtator/* routes.
// They were NOT removed — api.getPubTatorLiterature() calls them when a disease is loaded, and the
// literature genes it returns are added to the RWR network. Copied here so the archived view is self-describing.

  // ── PubTator Proxy ───────────────────────────────────────────────────────────

  const fetchPubTator = async (url: string, retries = 3, backoff = 1000): Promise<any> => {
    const key = cacheKey('pubtator', url);
    const cached = await readApiCache(key);
    if (cached) return cached.body;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DiseaseToTarget/2.0)',
          'Accept': 'application/json',
          'Connection': 'close'
        }
      });
      if (response.status === 429 && retries > 0) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchPubTator(url, retries - 1, backoff * 2);
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      await writeApiCache(key, { status: response.status, body: data, contentType: 'application/json' });
      return data;
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, backoff));
        return fetchPubTator(url, retries - 1, backoff * 2);
      }
      throw error;
    }
  };

  app.get("/api/pubtator/search", async (req, res) => {
    const queryParams = new URLSearchParams(req.query as any);
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?${queryParams.toString()}`;
    try {
      res.json(await fetchPubTator(url));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/pubtator/export", async (req, res) => {
    const queryParams = new URLSearchParams(req.query as any);
    const url = `https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?${queryParams.toString()}`;
    try {
      res.json(await fetchPubTator(url));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Resolve the active invite code: DB (admin-rotatable) first, then env fallback.
  const getActiveInviteCode = async (): Promise<string | null> => {
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from('app_config').select('value').eq('key', 'signup_invite_code').maybeSingle();
        const v: any = data?.value;
        const dbCode = v && typeof v === 'object' ? v.code : (typeof v === 'string' ? v : null);
        if (dbCode && String(dbCode).trim()) return String(dbCode).trim();
      } catch { /* fall through to env */ }
    }
    return process.env.SIGNUP_INVITE_CODE?.trim() || null;
  };
