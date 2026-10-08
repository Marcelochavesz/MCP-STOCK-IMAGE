# MCP Stock Image

Servidor MCP que busca imagens no **Pexels** e **Unsplash**, baixa em alta resolução e organiza em pastas por busca.

## Ferramentas
- `search_images` — busca e mostra resultados (sem baixar).
- `download_images` — busca, baixa e salva em `DOWNLOAD_DIR/<busca>/` com `manifest.json` (autor, link, fonte).

## Chaves de API (gratuitas)
- Pexels: https://www.pexels.com/api/ → `PEXELS_API_KEY`
- Unsplash: https://unsplash.com/developers → `UNSPLASH_ACCESS_KEY`

Basta uma das duas; as buscas usam as que estiverem configuradas.

## Instalação
```bash
git clone https://github.com/marcelochavesz/mcp-stock-image && cd mcp-stock-image
npm install
```

### Claude Code
```bash
claude mcp add stock-image \
  -e PEXELS_API_KEY=sua_chave -e UNSPLASH_ACCESS_KEY=sua_chave \
  -e DOWNLOAD_DIR=~/stock-images \
  -- node /caminho/para/mcp-stock-image/src/index.js
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "stock-image": {
      "command": "node",
      "args": ["/caminho/para/mcp-stock-image/src/index.js"],
      "env": { "PEXELS_API_KEY": "...", "UNSPLASH_ACCESS_KEY": "...", "DOWNLOAD_DIR": "~/stock-images" }
    }
  }
}
```

## Exemplo de uso
> "Baixe 8 imagens horizontais de skyline de cidade à noite."

Resultado: `~/stock-images/skyline-de-cidade-a-noite/01_pexels_123.jpg …` + `manifest.json`.

Respeite as licenças: Pexels e Unsplash permitem uso comercial, mas confira os termos e credite quando possível.
