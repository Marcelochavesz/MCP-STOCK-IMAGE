#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
const PIXABAY_KEY = process.env.PIXABAY_API_KEY;
const DOWNLOAD_DIR = path.resolve(
  (process.env.DOWNLOAD_DIR || path.join(os.homedir(), "stock-media")).replace(/^~/, os.homedir())
);

const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "sem-nome";

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${new URL(url).host}`);
  return res.json();
}

const need = (key, name) => { if (!key) throw new Error(`${name} não configurada`); };

// ---------- Fontes: cada função retorna itens normalizados ----------
const providers = {
  "pexels:image": async (q, n, o) => {
    need(PEXELS_KEY, "PEXELS_API_KEY");
    const p = new URLSearchParams({ query: q, per_page: String(n) });
    if (o) p.set("orientation", o);
    const d = await getJson(`https://api.pexels.com/v1/search?${p}`, { Authorization: PEXELS_KEY });
    return d.photos.map((x) => ({
      type: "image", source: "pexels", id: String(x.id), description: x.alt || "",
      width: x.width, height: x.height, author: x.photographer, pageUrl: x.url,
      downloadUrl: x.src.original, previewUrl: x.src.medium,
    }));
  },
  "pexels:video": async (q, n, o) => {
    need(PEXELS_KEY, "PEXELS_API_KEY");
    const p = new URLSearchParams({ query: q, per_page: String(n) });
    if (o) p.set("orientation", o);
    const d = await getJson(`https://api.pexels.com/videos/search?${p}`, { Authorization: PEXELS_KEY });
    return d.videos.map((x) => {
      // prefere o maior arquivo mp4 até Full HD
      const files = x.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.width <= 1920)
        .sort((a, b) => b.width - a.width);
      const f = files[0] || x.video_files[0];
      return {
        type: "video", source: "pexels", id: String(x.id), description: x.url.split("/").filter(Boolean).pop().replace(/-\d+$/, "").replace(/-/g, " "),
        width: f.width, height: f.height, duration: x.duration, author: x.user?.name, pageUrl: x.url,
        downloadUrl: f.link, previewUrl: x.image,
      };
    });
  },
  "unsplash:image": async (q, n, o) => {
    need(UNSPLASH_KEY, "UNSPLASH_ACCESS_KEY");
    const p = new URLSearchParams({ query: q, per_page: String(n) });
    if (o) p.set("orientation", o);
    const d = await getJson(`https://api.unsplash.com/search/photos?${p}`, { Authorization: `Client-ID ${UNSPLASH_KEY}` });
    return d.results.map((x) => ({
      type: "image", source: "unsplash", id: x.id, description: x.description || x.alt_description || "",
      width: x.width, height: x.height, author: x.user?.name, pageUrl: x.links.html,
      downloadUrl: x.urls.full, previewUrl: x.urls.small, trackUrl: x.links.download_location,
    }));
  },
  "pixabay:image": async (q, n, o) => {
    need(PIXABAY_KEY, "PIXABAY_API_KEY");
    const p = new URLSearchParams({ key: PIXABAY_KEY, q, per_page: String(Math.max(3, n)) });
    if (o) p.set("orientation", o === "landscape" ? "horizontal" : o === "portrait" ? "vertical" : "all");
    const d = await getJson(`https://pixabay.com/api/?${p}`);
    return d.hits.slice(0, n).map((x) => ({
      type: "image", source: "pixabay", id: String(x.id), description: x.tags,
      width: x.imageWidth, height: x.imageHeight, author: x.user, pageUrl: x.pageURL,
      downloadUrl: x.largeImageURL, previewUrl: x.webformatURL,
    }));
  },
  "pixabay:video": async (q, n) => {
    need(PIXABAY_KEY, "PIXABAY_API_KEY");
    const p = new URLSearchParams({ key: PIXABAY_KEY, q, per_page: String(Math.max(3, n)) });
    const d = await getJson(`https://pixabay.com/api/videos/?${p}`);
    return d.hits.slice(0, n).map((x) => {
      const v = x.videos.large?.url ? x.videos.large : x.videos.medium;
      return {
        type: "video", source: "pixabay", id: String(x.id), description: x.tags,
        width: v.width, height: v.height, duration: x.duration, author: x.user, pageUrl: x.pageURL,
        downloadUrl: v.url, previewUrl: x.videos.tiny?.thumbnail || x.videos.small?.thumbnail,
      };
    });
  },
};

const configured = () => ({
  pexels: !!PEXELS_KEY, unsplash: !!UNSPLASH_KEY, pixabay: !!PIXABAY_KEY,
});

function plan(types, sources) {
  const on = configured();
  const srcs = sources?.length ? sources : Object.keys(on).filter((s) => on[s]);
  const kinds = types === "both" ? ["image", "video"] : [types];
  return kinds.flatMap((k) => srcs.map((s) => `${s}:${k}`)).filter((key) => providers[key]);
}

async function search(query, types, sources, count, orientation) {
  const keys = plan(types, sources);
  const errors = [];
  if (!keys.length) {
    errors.push("Nenhuma fonte disponível. Configure PEXELS_API_KEY, UNSPLASH_ACCESS_KEY ou PIXABAY_API_KEY.");
    return { results: [], errors };
  }
  // count vale por tipo (imagem/vídeo), dividido entre as fontes daquele tipo
  const perType = {};
  for (const k of keys) perType[k.split(":")[1]] = (perType[k.split(":")[1]] || 0) + 1;
  const settled = await Promise.allSettled(
    keys.map((k) => providers[k](query, Math.ceil(count / perType[k.split(":")[1]]), orientation))
  );
  const lists = [];
  settled.forEach((r, i) => (r.status === "fulfilled" ? lists.push(r.value) : errors.push(`${keys[i]}: ${r.reason.message}`)));
  const results = [];
  for (const kind of ["image", "video"]) {
    const ofKind = lists.map((l) => l.filter((x) => x.type === kind)).filter((l) => l.length);
    const mixed = [];
    for (let i = 0; mixed.length < ofKind.reduce((a, l) => a + l.length, 0); i++)
      for (const l of ofKind) if (l[i]) mixed.push(l[i]);
    results.push(...mixed.slice(0, count));
  }
  return { results, errors };
}

async function downloadOne(item, dir, index) {
  if (item.trackUrl) fetch(item.trackUrl, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }).catch(() => {});
  const res = await fetch(item.downloadUrl);
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  const ct = res.headers.get("content-type") || "";
  const ext = item.type === "video" ? "mp4" : ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const file = `${String(index + 1).padStart(2, "0")}_${item.type}_${item.source}_${item.id}.${ext}`;
  const full = path.join(dir, file);
  await fs.writeFile(full, Buffer.from(await res.arrayBuffer()));
  return { ...item, file, path: full };
}

const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });

// ---------- Tools ----------
const server = new McpServer({ name: "stock-media", version: "2.0.0" });

const common = {
  type: z.enum(["image", "video", "both"]).default("both").describe("Tipo de mídia"),
  sources: z.array(z.enum(["pexels", "unsplash", "pixabay"])).optional()
    .describe("Bancos a usar. Padrão: todos com chave configurada. Unsplash só tem imagens"),
  orientation: z.enum(["landscape", "portrait", "squarish"]).optional()
    .describe("landscape = horizontal (YouTube 16:9); portrait = vertical (Shorts)"),
};

server.tool(
  "search_media",
  "Busca imagens e/ou vídeos de banco (Pexels, Unsplash, Pixabay) e mostra resultados com preview, sem baixar. Use termos em inglês para melhores resultados.",
  { query: z.string().min(1), ...common, count: z.number().int().min(1).max(30).default(8).describe("Quantidade por tipo") },
  async ({ query, type, sources, orientation, count }) => {
    const { results, errors } = await search(query, type, sources, count, orientation);
    return text({ total: results.length, errors, results });
  }
);

server.tool(
  "download_media",
  "Baixa imagens e/ou vídeos para uma ou várias palavras-chave (ex.: uma por cena do roteiro). Salva em DOWNLOAD_DIR/<canal>/<projeto>/<palavra-chave>/ e grava manifest.json com créditos.",
  {
    keywords: z.array(z.string().min(1)).min(1).max(40)
      .describe("Palavras-chave de busca em inglês, uma por cena/tema do roteiro"),
    ...common,
    count_per_keyword: z.number().int().min(1).max(15).default(3).describe("Quantidade por tipo e por palavra-chave"),
    channel: z.string().optional().describe("Nome do canal do YouTube (vira pasta)"),
    project: z.string().optional().describe("Nome do vídeo/projeto (vira subpasta)"),
  },
  async ({ keywords, type, sources, orientation, count_per_keyword, channel, project }) => {
    const root = path.join(DOWNLOAD_DIR, ...[channel, project].filter(Boolean).map(slug));
    await fs.mkdir(root, { recursive: true });
    const summary = [];
    const manifest = {};
    const errors = [];
    for (const kw of keywords) {
      const { results, errors: errs } = await search(kw, type, sources, count_per_keyword, orientation);
      errors.push(...errs.map((e) => `[${kw}] ${e}`));
      const dir = path.join(root, slug(kw));
      await fs.mkdir(dir, { recursive: true });
      const saved = [];
      for (const [i, item] of results.entries()) {
        try { saved.push(await downloadOne(item, dir, i)); }
        catch (e) { errors.push(`[${kw}] ${item.source}/${item.id}: ${e.message}`); }
      }
      manifest[kw] = saved.map(({ downloadUrl, previewUrl, trackUrl, ...r }) => r);
      await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ keyword: kw, files: manifest[kw] }, null, 2));
      summary.push({ keyword: kw, folder: dir, images: saved.filter((s) => s.type === "image").length, videos: saved.filter((s) => s.type === "video").length });
    }
    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify({ channel, project, keywords: manifest }, null, 2));
    return text({ root, summary, errors });
  }
);

await server.connect(new StdioServerTransport());
