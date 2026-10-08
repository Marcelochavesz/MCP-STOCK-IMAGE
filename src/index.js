#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
const DOWNLOAD_DIR = path.resolve(
  (process.env.DOWNLOAD_DIR || path.join(os.homedir(), "stock-images")).replace(/^~/, os.homedir())
);

const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "busca";

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${new URL(url).host}`);
  return res.json();
}

async function searchPexels(query, count, orientation) {
  if (!PEXELS_KEY) throw new Error("PEXELS_API_KEY não configurada");
  const p = new URLSearchParams({ query, per_page: String(count) });
  if (orientation) p.set("orientation", orientation);
  const data = await getJson(`https://api.pexels.com/v1/search?${p}`, { Authorization: PEXELS_KEY });
  return data.photos.map((x) => ({
    source: "pexels",
    id: String(x.id),
    description: x.alt || "",
    width: x.width,
    height: x.height,
    author: x.photographer,
    pageUrl: x.url,
    downloadUrl: x.src.original,
    previewUrl: x.src.medium,
  }));
}

async function searchUnsplash(query, count, orientation) {
  if (!UNSPLASH_KEY) throw new Error("UNSPLASH_ACCESS_KEY não configurada");
  const p = new URLSearchParams({ query, per_page: String(count) });
  if (orientation) p.set("orientation", orientation);
  const data = await getJson(`https://api.unsplash.com/search/photos?${p}`, {
    Authorization: `Client-ID ${UNSPLASH_KEY}`,
  });
  return data.results.map((x) => ({
    source: "unsplash",
    id: x.id,
    description: x.description || x.alt_description || "",
    width: x.width,
    height: x.height,
    author: x.user?.name,
    pageUrl: x.links.html,
    downloadUrl: x.urls.full,
    previewUrl: x.urls.small,
    trackUrl: x.links.download_location,
  }));
}

const SOURCES = { pexels: searchPexels, unsplash: searchUnsplash };

async function search(query, sources, count, orientation) {
  const perSource = Math.ceil(count / sources.length);
  const settled = await Promise.allSettled(sources.map((s) => SOURCES[s](query, perSource, orientation)));
  const results = [];
  const errors = [];
  settled.forEach((r, i) =>
    r.status === "fulfilled" ? results.push(...r.value) : errors.push(`${sources[i]}: ${r.reason.message}`)
  );
  // intercala as fontes para variar o resultado
  const bySource = sources.map((s) => results.filter((x) => x.source === s));
  const mixed = [];
  for (let i = 0; mixed.length < results.length; i++)
    for (const list of bySource) if (list[i]) mixed.push(list[i]);
  return { results: mixed.slice(0, count), errors };
}

async function downloadOne(img, dir, index) {
  if (img.trackUrl) {
    // exigência da API do Unsplash: registrar o download
    fetch(img.trackUrl, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }).catch(() => {});
  }
  const res = await fetch(img.downloadUrl);
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  const type = res.headers.get("content-type") || "";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const file = `${String(index + 1).padStart(2, "0")}_${img.source}_${img.id}.${ext}`;
  const full = path.join(dir, file);
  await fs.writeFile(full, Buffer.from(await res.arrayBuffer()));
  return { ...img, file, path: full };
}

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

const server = new McpServer({ name: "stock-image", version: "1.0.0" });

const common = {
  query: z.string().min(1).describe("Termo de busca (inglês costuma dar mais resultados)"),
  sources: z.array(z.enum(["pexels", "unsplash"])).optional()
    .describe("Bancos de imagem. Padrão: todos os configurados"),
  orientation: z.enum(["landscape", "portrait", "squarish"]).optional()
    .describe("landscape = horizontal (16:9, ideal para vídeo)"),
};

const defaultSources = () => [PEXELS_KEY && "pexels", UNSPLASH_KEY && "unsplash"].filter(Boolean);

server.tool(
  "search_images",
  "Busca imagens no Pexels e/ou Unsplash e retorna links de pré-visualização, sem baixar.",
  { ...common, count: z.number().int().min(1).max(30).default(10) },
  async ({ query, sources, orientation, count }) => {
    const src = sources?.length ? sources : defaultSources();
    if (!src.length) return text("Nenhuma chave de API configurada (PEXELS_API_KEY / UNSPLASH_ACCESS_KEY).");
    const { results, errors } = await search(query, src, count, orientation);
    return text({ total: results.length, errors, results });
  }
);

server.tool(
  "download_images",
  "Busca imagens no Pexels/Unsplash, baixa em alta resolução e salva organizadas em pasta própria da busca, com manifest.json (créditos dos autores).",
  {
    ...common,
    count: z.number().int().min(1).max(30).default(5).describe("Quantidade de imagens a baixar"),
    folder: z.string().optional().describe("Nome da subpasta (padrão: derivado da busca)"),
  },
  async ({ query, sources, orientation, count, folder }) => {
    const src = sources?.length ? sources : defaultSources();
    if (!src.length) return text("Nenhuma chave de API configurada (PEXELS_API_KEY / UNSPLASH_ACCESS_KEY).");
    const { results, errors } = await search(query, src, count, orientation);
    const dir = path.join(DOWNLOAD_DIR, slug(folder || query));
    await fs.mkdir(dir, { recursive: true });
    const saved = [];
    for (const [i, img] of results.entries()) {
      try { saved.push(await downloadOne(img, dir, i)); }
      catch (e) { errors.push(`${img.source}/${img.id}: ${e.message}`); }
    }
    const manifest = saved.map(({ downloadUrl, previewUrl, trackUrl, ...rest }) => rest);
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ query, manifest }, null, 2));
    return text({ folder: dir, downloaded: saved.length, errors, files: manifest });
  }
);

await server.connect(new StdioServerTransport());
