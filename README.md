# MCP Stock Media

Servidor MCP global para buscar e baixar **imagens e vídeos** de bancos gratuitos (**Pexels, Unsplash, Pixabay**), organizados por **canal → projeto → palavra-chave**.

## Fluxo
1. Você escreve o roteiro com o Claude.
2. Peça: "tire as palavras-chave de cada cena em inglês e baixe imagens e vídeos horizontais para o canal X, vídeo Y".
3. O Claude chama `download_media` e os arquivos caem em:

```
~/stock-media/<canal>/<projeto>/<palavra-chave>/
   01_video_pexels_123.mp4
   02_image_unsplash_abc.jpg
   manifest.json          (autor, link, fonte, duração)
~/stock-media/<canal>/<projeto>/manifest.json   (índice geral)
```

## Ferramentas
- `search_media` — busca com preview, sem baixar.
- `download_media` — várias palavras-chave de uma vez; `type` = image | video | both; `orientation` = landscape (16:9) / portrait (Shorts); `channel` e `project` definem as pastas.

| Banco | Imagens | Vídeos |
|---|---|---|
| Pexels | sim | sim |
| Pixabay | sim | sim |
| Unsplash | sim | não |

## Chaves de API (todas gratuitas, use as que quiser)
- `PEXELS_API_KEY` — https://www.pexels.com/api/
- `UNSPLASH_ACCESS_KEY` — https://unsplash.com/developers
- `PIXABAY_API_KEY` — https://pixabay.com/api/docs/
- `DOWNLOAD_DIR` (opcional, padrão `~/stock-media`)

## Instalação global (todos os projetos)
```bash
git clone https://github.com/marcelochavesz/mcp-stock-image ~/mcp-stock-image
cd ~/mcp-stock-image && git checkout claude/vibrant-faraday-2sv01e && npm install

claude mcp add stock-media --scope user \
  -e PEXELS_API_KEY=... -e UNSPLASH_ACCESS_KEY=... -e PIXABAY_API_KEY=... \
  -e DOWNLOAD_DIR=~/stock-media \
  -- node ~/mcp-stock-image/src/index.js
```
`--scope user` deixa o MCP disponível em qualquer pasta/projeto. No Claude Desktop, use o mesmo comando/args/env no `claude_desktop_config.json`.

Licenças: os três bancos permitem uso comercial, mas confira os termos de cada um.
