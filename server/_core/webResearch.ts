type SearchResult = { title: string; url: string; snippet: string };
export type ResearchSource = SearchResult & { content: string };

const SEARCH_TIMEOUT_MS = 8000;
const PAGE_TIMEOUT_MS = 9000;
const MAX_SOURCES = 10;
const MAX_CONTENT_PER_SOURCE = 7000;

function withTimeout(signalMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanText(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validPublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(url.hostname)) return false;
    return true;
  } catch { return false; }
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && results.length < MAX_SOURCES * 2) {
    const url = decodeHtml(match[1]);
    const title = cleanText(match[2]);
    const snippet = cleanText(match[3]);
    if (validPublicUrl(url) && title && !results.some(item => item.url === url)) results.push({ title, url, snippet });
  }
  return results;
}

function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const pattern = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*><a[\s\S]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && results.length < MAX_SOURCES * 2) {
    let url = decodeHtml(match[1]);
    try {
      const parsed = new URL(url);
      const encoded = parsed.searchParams.get("u");
      if (encoded?.startsWith("a1")) url = Buffer.from(encoded.slice(2), "base64url").toString("utf8");
    } catch { /* mantém o endereço original */ }
    const title = cleanText(match[2]);
    const snippet = cleanText(match[3]);
    if (validPublicUrl(url) && title && !results.some(item => item.url === url)) results.push({ title, url, snippet });
  }
  return results;
}

async function search(query: string) {
  const timeout = withTimeout(SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "user-agent": "AndreoAI/1.0 research bot" }, signal: timeout.signal,
    });
    if (response.ok) {
      const results = parseSearchResults(await response.text());
      if (results.length) return results;
    }
  } catch { /* tenta o fallback abaixo */ } finally { timeout.clear(); }

  const fallback = withTimeout(SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AndreoAI research)" }, signal: fallback.signal,
    });
    if (!response.ok) return [];
    return parseBingResults(await response.text());
  } catch { return []; } finally { fallback.clear(); }
}

async function readPage(result: SearchResult): Promise<ResearchSource | null> {
  const timeout = withTimeout(PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(result.url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AndreoAI research)" }, signal: timeout.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
    const content = cleanText(await response.text()).slice(0, MAX_CONTENT_PER_SOURCE);
    return content.length >= 180 ? { ...result, content } : null;
  } catch { return null; } finally { timeout.clear(); }
}

export function needsWebResearch(text: string) {
  const value = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/https?:\/\//.test(value)) return true;
  if (/\b(pesquise|pesquisar|pesquisa|investigue|investigar|verifique|confira|fontes|noticia|noticias|aconteceu|ocorreu|hoje|agora|atual|atualmente|recente|recentemente|ultima|ultimo|verdade|fato|quem e|o que houve|o que aconteceu|por que aconteceu)\b/.test(value)) return true;
  return /\b(sabe|me diga|explique)\b[\s\S]{0,80}\b(com|sobre|a respeito de)\b/.test(value) && /\?|\b(empresa|pessoa|caso|evento|site|produto|servico)\b/.test(value);
}

export async function researchWeb(question: string) {
  const normalized = question.replace(/\s+/g, " ").trim().slice(0, 500);
  const technical = /\b(api|sdk|biblioteca|framework|codigo|código|programa|programar|npm|github|endpoint|integracao|integração|documentacao|documentação|erro|typescript|javascript|python|react|node)\b/i.test(normalized);
  const queries = technical
    ? [normalized, `${normalized} documentação oficial`, `${normalized} API exemplo versão`, `${normalized} GitHub issues`]
    : [normalized, `${normalized} notícias fontes`, `${normalized} análise`, `${normalized} site oficial`];
  const found = (await Promise.all(queries.map(search))).flat();
  const unique = found.filter((item, index, all) => all.findIndex(other => other.url === item.url) === index).slice(0, MAX_SOURCES);
  const sources = (await Promise.all(unique.map(readPage))).filter((item): item is ResearchSource => Boolean(item));
  return { query: normalized, sources };
}

export function researchContext(result: Awaited<ReturnType<typeof researchWeb>>) {
  if (!result.sources.length) return "PESQUISA WEB: não foi possível obter páginas públicas agora. Não invente fontes; informe essa limitação e responda apenas com o que puder afirmar com segurança.";
  return `PESQUISA WEB REALIZADA AGORA para: ${result.query}\nForam abertas e lidas ${result.sources.length} páginas públicas. Compare as fontes, destaque divergências e não trate snippets como prova. Cite os links consultados em Markdown ao lado das afirmações correspondentes.\n\n${result.sources.map((source, index) => `[Fonte ${index + 1}] ${source.title}\nURL: ${source.url}\nResumo do resultado: ${source.snippet}\nConteúdo lido: ${source.content}`).join("\n\n")}`;
}
