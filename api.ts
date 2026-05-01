import { Target, DrugInfo, DiseaseInfo, EnrichmentResult, PubMedStats, ClinicalSample, ExpressionRow, DrillDownData, PubTatorResult } from './types';
import { GoogleGenAI } from "@google/genai";

const OPEN_TARGETS_API = 'https://api.platform.opentargets.org/api/v4/graphql';
const ENRICHR_API = 'https://maayanlab.cloud/Enrichr';
const PUBMED_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const fetchWithRetry = async (url: string, options: RequestInit = {}, retries: number = 3, backoff: number = 1000): Promise<Response> => {
  try {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
}

export const api = {
  async searchDiseases(query: string): Promise<DiseaseInfo[]> {
    const GQL_QUERY = `
      query SearchDisease($queryString: String!) {
        search(queryString: $queryString, entityNames: ["disease"], page: {index: 0, size: 25}) {
          hits { id name score description }
        }
      }
    `;

    const executeSearch = async (searchTerm: string) => {
      try {
        const res = await fetch(OPEN_TARGETS_API, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ query: GQL_QUERY, variables: { queryString: searchTerm } }) 
        });
        const result = await res.json();
        return result.data?.search?.hits || [];
      } catch (err) { return []; }
    };

    // Stage 1: Direct Search
    let hits = await executeSearch(query);

    // Stage 2: Semantic Correction Fallback
    // If no hits found or query looks like a misspelling (imprecise), use Gemini to normalize
    if (hits.length === 0 || query.length < 4 || /^[A-Z\s]+$/.test(query)) {
      try {
        let correctedQuery = "";
        if (process.env.NVIDIA_API_KEY) {
          const nvRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}` },
            body: JSON.stringify({
              model: "NVIDIABuild-Autogen-66",
              messages: [{ role: 'user', content: `Identify the single most likely standard clinical disease name for the following potentially misspelled or imprecise term: "${query}". Return only the corrected name string, nothing else.` }],
              temperature: 0.2
            })
          });
          const nvData = await nvRes.json();
          correctedQuery = nvData.choices?.[0]?.message?.content?.trim() || "";
        } else if (process.env.GEMINI_API_KEY || process.env.API_KEY) {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
          const correctionResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Identify the single most likely standard clinical disease name for the following potentially misspelled or imprecise term: "${query}". Return only the corrected name string, nothing else.`,
          });
          correctedQuery = correctionResponse.text?.trim() || "";
        }
        
        if (correctedQuery && correctedQuery.toLowerCase() !== query.toLowerCase()) {
          const secondHits = await executeSearch(correctedQuery);
          if (secondHits.length > 0) {
            hits = secondHits;
          }
        }
      } catch (e) {
        console.error("Semantic correction failed", e);
      }
    }

    return hits.map((h: any) => ({ id: h.id, name: h.name, score: h.score }));
  },

  async getGenes(efoId: string, size: number = 30, page: number = 0): Promise<Target[]> {
    const GQL_QUERY = `
      query GetAssociatedTargets($efoId: String!, $size: Int!, $page: Int!) {
        disease(efoId: $efoId) {
          associatedTargets(page: {index: $page, size: $size}) {
            rows {
              target { 
                id 
                approvedSymbol 
                approvedName 
                pathways { pathway }
                expressions {
                  tissue { label }
                  rna { value }
                }
                tractability {
                  label
                  modality
                  value
                }
              }
              score
              datatypeScores { id score }
            }
          }
        }
      }
    `;

    try {
      const res = await fetch(OPEN_TARGETS_API, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ query: GQL_QUERY, variables: { efoId, size, page } }) 
      });
      const data = await res.json();
      const rows = data.data?.disease?.associatedTargets?.rows || [];
      const seen = new Set();
      const uniqueTargets: Target[] = [];

      for (const r of rows) {
        if (!seen.has(r.target.id)) {
          seen.add(r.target.id);

          // G
          const geneticScore = Math.max(
            r.datatypeScores.find((s: any) => s.id === 'genetic_association')?.score || 0,
            r.datatypeScores.find((s: any) => s.id === 'somatic_mutation')?.score || 0,
            r.datatypeScores.find((s: any) => s.id === 'genetic_literature')?.score || 0
          );

          // E — your expression logic
          const vals = (r.target.expressions || [])
            .map((e: any) => e.rna?.value || 0)
            .filter((v: number) => v > 0)
            .sort((a: number, b: number) => b - a);
          let expressionScore = 0;
          if (vals.length > 0) {
            const top1 = vals[0];
            const top3avg = vals.slice(0, 3).reduce((a: number, b: number) => a + b, 0) / Math.min(3, vals.length);
            const meanAll = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
            const strength = Math.min(1, Math.log10(top3avg + 1) / 4);
            const selectivity = meanAll > 0
              ? Math.min(1, Math.log10((top1 / meanAll) + 1) / Math.log10(6))
              : 0;
            expressionScore = strength * 0.7 + selectivity * 0.3;
          }

          // T — tractability hierarchy
          const tractability = r.target.tractability || [];
          const score = (modality: string, label: string) =>
            tractability.some((t: any) => t.modality === modality && t.label === label && t.value === true);
          const targetScore = (() => {
            if (score('SM', 'Approved Drug') || score('AB', 'Approved Drug') || score('PR', 'Approved Drug')) return 1.0;
            if (score('SM', 'Advanced Clinical') || score('AB', 'Advanced Clinical') || score('PR', 'Advanced Clinical')) return 0.85;
            if (score('SM', 'Phase 1 Clinical') || score('AB', 'Phase 1 Clinical') || score('PR', 'Phase 1 Clinical')) return 0.70;
            if (score('SM', 'Structure with Ligand') || score('SM', 'High-Quality Ligand')) return 0.55;
            if (score('SM', 'High-Quality Pocket') || score('SM', 'Med-Quality Pocket')) return 0.40;
            if (score('SM', 'Druggable Family')) return 0.25;
            return 0.1;
          })();

          // Literature — working fine, keep as is
          const literatureScore = r.datatypeScores.find(
            (s: any) => s.id === 'literature'
          )?.score || 0;

          // GET Score
          const getScore = (
            geneticScore * 0.50 +
            expressionScore * 0.25 +
            targetScore * 0.25
          );

          uniqueTargets.push({
            id: r.target.id,
            symbol: r.target.approvedSymbol,
            name: r.target.approvedName,
            overallScore: r.score,
            getScore,
            geneticScore,
            expressionScore,
            literatureScore,
            baselineExpression: 0,
            combinedExpression: expressionScore,
            targetScore,
            pathways: r.target.pathways?.map((p: any) => ({ 
              id: p.pathway, label: p.pathway 
            })) || [],
            source: 'OT'
          });
        }
      }

      // Sort by GET Score
      uniqueTargets.sort((a, b) => (b.getScore ?? 0) - (a.getScore ?? 0));

      return uniqueTargets;
    } catch (err) { return []; }
  },

  async getTargetDrugs(ensemblId: string): Promise<DrugInfo[]> {
    const GQL_QUERY = `query GetTargetDrugs($ensemblId: String!) { target(ensemblId: $ensemblId) { knownDrugs { rows { drug { id name mechanismsOfAction { rows { mechanismOfAction } } } status phase } } } }`;
    try {
      const res = await fetch(OPEN_TARGETS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GQL_QUERY, variables: { ensemblId } }) });
      const data = await res.json();
      const rows = data.data?.target?.knownDrugs?.rows || [];
      const seen = new Set();
      const uniqueDrugs: DrugInfo[] = [];
      for (const r of rows) {
        if (!seen.has(r.drug.id)) {
          seen.add(r.drug.id);
          uniqueDrugs.push({
            id: r.drug.id,
            name: r.drug.name,
            phase: r.phase,
            status: r.status,
            mechanism: r.drug.mechanismsOfAction?.rows[0]?.mechanismOfAction || "Unknown Mechanism"
          });
        }
      }
      return uniqueDrugs;
    } catch (e) { return []; }
  },

  async getEnrichment(genes: string[]): Promise<EnrichmentResult[]> {
    if (genes.length === 0) return [];
    try {
      const formData = new FormData();
      formData.append('list', genes.join('\n'));
      const addRes = await fetch(`${ENRICHR_API}/addList`, { method: 'POST', body: formData });
      const addData = await addRes.json();
      const enRes = await fetch(`${ENRICHR_API}/enrich?userListId=${addData.userListId}&backgroundType=KEGG_2021_Human`);
      const enData = await enRes.json();
      return enData['KEGG_2021_Human']?.map((r: any) => ({ term: r[1], pValue: r[2], combinedScore: r[4], genes: r[5] })) || [];
    } catch (e) { return []; }
  },

  async getPubMedStats(symbol: string, diseaseName: string): Promise<PubMedStats> {
    const apiKeyParam = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : '';
    const baseQuery = `("${diseaseName}"[Title/Abstract]) AND ("${symbol}"[Title/Abstract])`;
    const recentQuery = `${baseQuery} AND ("2024"[Date - Publication] : "2025"[Date - Publication])`;

    const searchLink = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(recentQuery)}&sort=pubdate`;
    const primarySearchLink = searchLink;

    try {
      const [totalData, recentData] = await Promise.all([
        fetchWithRetry(`${PUBMED_API}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(baseQuery)}&retmode=json${apiKeyParam}`)
          .then(r => r.json()),
        fetchWithRetry(`${PUBMED_API}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(recentQuery)}&retmode=json${apiKeyParam}`)
          .then(r => r.json())
      ]);

      const total = parseInt(totalData.esearchresult.count || '0');
      const recent = parseInt(recentData.esearchresult.count || '0');
      const recentIds = (recentData.esearchresult.idlist ?? []).slice(0, 3).join(',');

      let topPapers: { title: string; id: string }[] = [];
      if (recentIds) {
        const summaryData = await fetchWithRetry(
          `${PUBMED_API}/esummary.fcgi?db=pubmed&id=${recentIds}&retmode=json${apiKeyParam}`
        ).then(r => r.json());

        topPapers = (summaryData.result.uids ?? [])
          .slice(0, 3)
          .map((k: string) => ({
            title: summaryData.result[k]?.title ?? 'Untitled',
            id: k
          }));
      }

      return { total, recent, topPapers, searchLink, primarySearchLink };
    } catch (e) {
      console.error(`PubMed fetch failed [${symbol}/${diseaseName}]:`, e);
      return { total: 0, recent: 0, topPapers: [], searchLink, primarySearchLink };
    }
  },

  async getDrillDownData(symbol: string, diseaseName: string): Promise<DrillDownData> {
    const drillDown: DrillDownData = {
      trial_count: 0,
      max_phase: 'N/A',
      active_trial_present: false,
      paper_count: 0,
      recent_paper_count: 0,
      latest_publication_date: 'N/A'
    };

    try {
      // ClinicalTrials.gov API v2
      try {
        const fields = [
          'protocolSection.identificationModule.nctId',
          'protocolSection.statusModule.overallStatus',
          'protocolSection.designModule.phases',
          'protocolSection.designModule.studyType',
          'protocolSection.conditionsModule.conditions',
          'protocolSection.armsInterventionsModule.interventions',
          'protocolSection.sponsorCollaboratorsModule.leadSponsor.class'
        ].join(',');

        const ctUrl = `https://clinicaltrials.gov/api/v2/studies?query.cond=${encodeURIComponent(
          diseaseName
        )}&query.term=${encodeURIComponent(symbol)}&pageSize=100&countTotal=true&fields=${fields}`;

        const globalCtUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(symbol)}&pageSize=0&countTotal=true`;

        const [ctRes, globalCtRes] = await Promise.all([
          fetchWithRetry(ctUrl),
          fetchWithRetry(globalCtUrl)
        ]);

        let ctData = ctRes.ok ? await ctRes.json() : { studies: [], totalCount: 0 };

        if (ctData.totalCount === 0 || !ctData.studies || ctData.studies.length === 0) {
          // Fallback: search by term only (broader)
          const fallbackUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(symbol)}+${encodeURIComponent(diseaseName)}&pageSize=100&countTotal=true&fields=${fields}`;
          const fallbackRes = await fetchWithRetry(fallbackUrl);
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            if (fallbackData.totalCount > 0) {
              ctData = fallbackData;
            }
          }
        }

        if (ctData.studies) {
          const studies = ctData.studies || [];
          drillDown.trial_count = ctData.totalCount ?? studies.length;

          const interventionalStudies = studies.filter((s: any) =>
            s.protocolSection?.designModule?.studyType === 'INTERVENTIONAL'
          );
          drillDown.interventional_count = interventionalStudies.length;

          const phaseOrder = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'];
          let maxPhaseIdx = -1;
          const phaseBreakdown: Record<string, number> = { 'EARLY_PHASE1': 0, 'PHASE1': 0, 'PHASE2': 0, 'PHASE3': 0, 'PHASE4': 0 };
          const conditionsMap: Record<string, number> = {};
          const drugsMap: Record<string, number> = {};
          const sponsorMap: Record<string, number> = {};

          interventionalStudies.forEach((s: any) => {
            const phases = s.protocolSection?.designModule?.phases || [];
            phases.forEach((p: string) => {
              const idx = phaseOrder.indexOf(p);
              if (idx > maxPhaseIdx) maxPhaseIdx = idx;
              if (phaseBreakdown[p] !== undefined) phaseBreakdown[p]++;
            });

            const conds = s.protocolSection?.conditionsModule?.conditions || [];
            conds.forEach((c: string) => {
              conditionsMap[c] = (conditionsMap[c] || 0) + 1;
            });

            const interventions = s.protocolSection?.armsInterventionsModule?.interventions || [];
            interventions
              .filter((i: any) => i.type === 'DRUG' || i.type === 'BIOLOGICAL')
              .forEach((i: any) => {
                const name = i.name.trim();
                drugsMap[name] = (drugsMap[name] || 0) + 1;
              });
          });

          studies.forEach((s: any) => {
            const cls = s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.class;
            if (cls) {
              const label = (cls === 'NIH' || cls === 'FED' || cls === 'U_S_FED') 
                ? 'NIH' 
                : cls;
              sponsorMap[label] = (sponsorMap[label] || 0) + 1;
            }
          });

          drillDown.max_phase = maxPhaseIdx >= 0 ? phaseOrder[maxPhaseIdx] : 'N/A';
          drillDown.phase_breakdown = phaseBreakdown;
          drillDown.top_conditions = Object.entries(conditionsMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
          drillDown.top_drugs = Object.entries(drugsMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
          drillDown.sponsor_breakdown = sponsorMap;

          const activeStatuses = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION'];
          drillDown.active_trial_present = studies.some((s: any) =>
            activeStatuses.includes(s.protocolSection?.statusModule?.overallStatus)
          );
        }

        if (globalCtRes.ok) {
          const globalCtData = await globalCtRes.json();
          drillDown.total_trials_globally = globalCtData.totalCount || 0;
        }
      } catch (err) {
        console.error('ClinicalTrials fetch failed:', err);
      }

      // Europe PMC
      try {
        const currentYear = new Date().getFullYear();
        const threeYearsAgo = currentYear - 3;
        // Clean disease name for search
        const cleanDisease = diseaseName.replace(/['"]/g, '');
        const epQuery = `${symbol} AND "${cleanDisease}"`;
        const epRecentQuery = `${symbol} AND "${cleanDisease}" AND FIRST_PDATE:[${threeYearsAgo}-01-01 TO ${currentYear}-12-31]`;
        
        const [epTotalRes, epRecentRes] = await Promise.all([
          fetchWithRetry(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(epQuery)}&format=json&pageSize=1&sort_date:y`),
          fetchWithRetry(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(epRecentQuery)}&format=json&pageSize=1`)
        ]);

        if (epTotalRes.ok) {
          const epTotalData = await epTotalRes.json();
          if (epTotalData && typeof epTotalData.hitCount !== 'undefined') {
            drillDown.paper_count = epTotalData.hitCount || 0;
            if (epTotalData.resultList?.result?.length > 0) {
              const firstResult = epTotalData.resultList.result[0];
              drillDown.latest_publication_date = firstResult.firstPubDate || firstResult.pubYear || 'N/A';
              drillDown.epmc_top_paper = firstResult.title;
              drillDown.epmc_journal = firstResult.journalTitle || firstResult.journalInfo?.journal?.title || 'N/A';
              drillDown.epmc_year = firstResult.pubYear || 'N/A';
            }
          }
        }

        if (epRecentRes.ok) {
          const epRecentData = await epRecentRes.json();
          if (epRecentData && typeof epRecentData.hitCount !== 'undefined') {
            drillDown.recent_paper_count = epRecentData.hitCount || 0;
            if (drillDown.paper_count > 0) {
              drillDown.epmc_velocity = ((drillDown.recent_paper_count / drillDown.paper_count) * 100).toFixed(1) + '%';
            } else {
              drillDown.epmc_velocity = '0%';
            }
          }
        }
      } catch (err) {
        console.error('Europe PMC fetch failed:', err);
      }

      // PubMed Stats
      try {
        const apiKeyParam = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : '';
        const toolEmail = `&tool=GeneInsightExplorer&email=kurmachalamnikhil@gmail.com`;
        const baseQuery = `("${diseaseName}"[Title/Abstract]) AND ("${symbol}"[Title/Abstract])`;
        
        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;
        const recentQuery = `${baseQuery} AND ("${prevYear}"[Date - Publication] : "${currentYear}"[Date - Publication])`;

        const [totalRes, recentRes] = await Promise.all([
          fetchWithRetry(`${PUBMED_API}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(baseQuery)}&retmode=json${apiKeyParam}${toolEmail}`),
          fetchWithRetry(`${PUBMED_API}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(recentQuery)}&retmode=json${apiKeyParam}${toolEmail}`)
        ]);

        const totalData = totalRes.ok ? await totalRes.json() : null;
        const recentData = recentRes.ok ? await recentRes.json() : null;

        if (totalData?.esearchresult) {
          const total = parseInt(totalData.esearchresult.count || '0');
          drillDown.total_signals = total;
          
          if (recentData?.esearchresult) {
            const recent = parseInt(recentData.esearchresult.count || '0');
            const recentIds = (recentData.esearchresult.idlist ?? []).slice(0, 3).join(',');
            
            drillDown.recent_signals = recent;
            drillDown.signal_velocity = total > 0 ? ((recent / total) * 100).toFixed(1) + '%' : '0%';

            if (recentIds) {
              const summaryRes = await fetchWithRetry(
                `${PUBMED_API}/esummary.fcgi?db=pubmed&id=${recentIds}&retmode=json${apiKeyParam}${toolEmail}`
              );
              if (summaryRes.ok) {
                const summaryData = await summaryRes.json();
                if (summaryData?.result) {
                  drillDown.top_papers = (summaryData.result.uids ?? [])
                    .slice(0, 3)
                    .map((k: string) => ({
                      title: summaryData.result[k]?.title ?? 'Untitled',
                      id: k
                    }));
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(`PubMed stats fetch failed in drilldown [${symbol}/${diseaseName}]:`, e);
      }

    } catch (e) {
      console.error("Drill down fetch failed:", e);
    }

    return drillDown;
  },

  async getPubTatorLiterature(disease: string): Promise<{ results: PubTatorResult[], pool: string[] }> {
    const query = disease;
    const pmids: string[] = [];
    const BLACKLIST = new Set([
      'TNM','PCR','DNA','RNA','MRI','CT','PET',
      'IHC','BMI','AUC','ROC','HER','CI','HR',
      'OR','SD','CR','ER','PFS','DFS','RCT',
      'FDA','WHO','CRP','LDH','PSA','CBC',
      'ECG','EEG','CEA','AFP','HCG','CA'
    ]);

    // 1. Fetch PMIDs
    // Relevant papers (established genes like APP, APOE)
    for (let page = 1; page <= 5; page++) {
      try {
        const res = await fetchWithRetry(
          `/api/pubtator/search?text=${encodeURIComponent(query)}&sort=score%20desc&type=Gene&page=${page}`
        );
        if (res.ok) {
          const data = await res.json();
          (data.results || []).forEach((r: any) => pmids.push(String(r.pmid)));
        }
      } catch (e) {
        console.error(`PubTator search failed on page ${page}:`, e);
      }
      // Brief pause between search pages
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Recent papers (novel genes like PHGDH)
    for (let page = 1; page <= 25; page++) {
      try {
        const res = await fetchWithRetry(
          `/api/pubtator/search?text=${encodeURIComponent(query)}&sort=date%20desc&type=Gene&page=${page}`
        );
        if (res.ok) {
          const data = await res.json();
          (data.results || []).forEach((r: any) => pmids.push(String(r.pmid)));
        }
      } catch (e) {
        console.error(`PubTator search failed on page ${page}:`, e);
      }
      // Brief pause between search pages
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Deduplicate
    const uniquePmids = [...new Set(pmids)];

    if (uniquePmids.length === 0) return { results: [], pool: [] };

    // 2. Extract unique genes from PubTator3 export
    const geneCount: Record<string, number> = {};
    const pmidBatches = [];
    for (let i = 0; i < uniquePmids.length; i += 10) {
      pmidBatches.push(uniquePmids.slice(i, i + 10));
    }

    for (const batch of pmidBatches) {
      try {
        const res = await fetchWithRetry(`/api/pubtator/export?pmids=${batch.join(',')}&full=true`);
        if (res.ok) {
          const data = await res.json();
          const docs = data.PubTator3 || (Array.isArray(data) ? data : [data]);

          for (const doc of docs) {
            for (const passage of doc.passages || []) {
              for (const anno of passage.annotations || []) {
                if (anno.infons?.type !== "Gene") continue;
                
                const identifier = anno.infons?.identifier;
                if (!identifier || !/^\d+$/.test(identifier)) continue; 
                
                const geneName = anno.text || anno.infons?.name;
                if (!geneName) continue;
                if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(geneName)) continue; 
                if (BLACKLIST.has(geneName.toUpperCase())) continue;
                
                const g = geneName.toUpperCase();
                geneCount[g] = (geneCount[g] || 0) + 1;
              }
            }
          }
        }
      } catch (e) {
        console.error(`PubTator export failed for batch:`, e);
      }
    }

    const geneList = Object.entries(geneCount)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([gene]) => gene);

    const initialBatch = geneList.slice(0, 30);
    const results = await this.getPubTatorVelocityBatch(initialBatch, disease);

    return {
      results: results.sort((a, b) => b.velocity - a.velocity),
      pool: geneList
    };
  },

  async getPubTatorVelocityBatch(genes: string[], disease: string): Promise<PubTatorResult[]> {
    const results: PubTatorResult[] = [];
    const batchSize = 5;
    for (let i = 0; i < genes.length; i += batchSize) {
      const batch = genes.slice(i, i + batchSize);
      const batchPromises = batch.map(async (gene) => {
        try {
          const res = await fetchWithRetry(`/api/pubtator/search?text=${encodeURIComponent(`${gene} ${disease}`)}&sort=date%20desc&type=Gene&page=1`);
          const data = res.ok ? await res.json() : {};

          const total = data.count ?? 0;
          const topResult = data.results?.[0] || {};

          const currentYear = new Date().getFullYear();
          const yearFacets = data.facets?.facet_fields?.year || [];
          const recentCount = yearFacets
            .filter((y: any) => 
              String(y.name).match(/^\d{4}$/) &&
              parseInt(y.name) >= currentYear - 2
            )
            .reduce((sum: number, y: any) => 
              sum + (y.value || 0), 0);

          return {
            gene,
            totalPapers: total,
            recentPapers: recentCount,
            velocity: total > 0 ? (recentCount / total) * 100 : 0,
            topPaper: topResult.title || "N/A",
            journal: topResult.journal || "N/A",
            year: topResult.date ? String(topResult.date).slice(0, 4) : "N/A",
            pmid: topResult.pmid ? String(topResult.pmid) : "N/A"
          };
        } catch (err) {
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...(batchResults.filter(r => r !== null) as PubTatorResult[]));

      if (i + batchSize < genes.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    return results.filter(r => r.totalPapers > 3);
  },

  async getAiSummary(symbol: string, diseaseName: string, drillDown: DrillDownData): Promise<string> {
    try {
      const prompt = `Based on the following clinical trial data for the gene ${symbol} in the context of ${diseaseName}:
      - Total Trials: ${drillDown.trial_count}
      - Max Phase: ${drillDown.max_phase}
      - Phase Breakdown: ${JSON.stringify(drillDown.phase_breakdown)}
      - Top Conditions: ${JSON.stringify(drillDown.top_conditions)}
      - Top Drugs: ${JSON.stringify(drillDown.top_drugs)}
      - Sponsor Breakdown: ${JSON.stringify(drillDown.sponsor_breakdown)}
      
      Generate a concise, professional clinical insight (2-3 sentences). Focus on validation level, commercial interest, and standard-of-care potential. Do not use placeholders.`;
      
      if (process.env.NVIDIA_API_KEY) {
        const nvRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}` },
          body: JSON.stringify({
            model: "NVIDIABuild-Autogen-66",
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5
          })
        });
        const nvData = await nvRes.json();
        return nvData.choices?.[0]?.message?.content?.trim() || "No summary available.";
      } else {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY! });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
        });
        return response.text?.trim() || "No summary available.";
      }
    } catch (e) {
      console.error("AI Clinical Summary failed", e);
      return "Failed to generate AI summary.";
    }
  },


  async getTcgaClinical(cancerType: string, offset: number = 0): Promise<any[]> {
    try {
      const res = await fetch(`https://aimed.uab.edu/apex/gtkb/clinical_data/pancan/${cancerType.toLowerCase()}?offset=${offset}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return data.items || data.rows || (Array.isArray(data) ? data : []);
    } catch (e) { 
      console.error("getTcgaClinical failed:", e);
      return []; 
    }
  },

  async getStringInteractions(genes: string[]): Promise<any[]> {
    try {
      const identifiers = genes.join('%0d');
      const res = await fetch(`https://string-db.org/api/json/network?identifiers=${identifiers}&species=9606&required_score=150&caller_identity=diseasetotarget_app`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getStringInteractions failed:", e);
      return [];
    }
  },

  async getTcgaExpressionPage(cancerType: string, genes: string[], offset: number): Promise<{ items: any[], hasMore: boolean }> {
    try {
      const genesParam = genes.join(',');
      const res = await fetch(`https://aimed.uab.edu/apex/gtkb/gene_exp/data?condition=${cancerType.toLowerCase()}&genes=${genesParam}&row_limit=10000`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return {
        items: data.result || data.items || data.rows || (Array.isArray(data) ? data : []),
        hasMore: data.hasMore || false
      };
    } catch (e) { 
      console.error("getTcgaExpressionPage failed:", e);
      return { items: [], hasMore: false }; 
    }
  }
};