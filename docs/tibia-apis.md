# Referência das APIs de Tibia

> Verificado com chamadas reais em 2026-09-16. TibiaData `v4.10.0`, TibiaWikiApi (instância pública tibiawiki.dev).
> Antes de confiar em detalhes de payload, confirme a versão em `information.api.release` (TibiaData).

---

## 1. TibiaData API — dados *vivos* do jogo

- **Base:** `https://api.tibiadata.com` (produção) · `https://dev.tibiadata.com` (edge, instável)
- **Spec:** `https://docs.tibiadata.com/swagger.json` (Swagger 2.0, contém v3 **e** v4)
- **Origem:** scraping do `tibia.com`. Fansite oficial suportado desde 2016. Código MIT, dados © CipSoft.
- **Auth:** nenhuma. **Rate limit em produção:** sem limite declarado. **Em `dev.`:** 1 req/s e 100 req/h.
- **CORS:** responde `Access-Control-Allow-Origin: *` — chamável do browser (ao contrário da TibiaWikiApi).
- **Versões:** use **v4**. v3 ainda responde, mas é legado — não escrever código novo contra ele.

### Envelope (idêntico em todos os endpoints)

```json
{
  "<recurso>": { },
  "information": {
    "api": { "version": 4, "release": "4.10.0", "commit": "d53b603c..." },
    "timestamp": "2026-09-16T14:05:39Z",
    "tibia_urls": ["https://www.tibia.com/community/?subtopic=characters&name=bobeek"],
    "status": { "http_code": 200 }
  }
}
```

Em erro o recurso some e `status` ganha `error` (código numérico) + `message`:

```json
{"information":{"status":{"http_code":400,"error":11002,"message":"the provided world does not exist"}}}
```

Códigos observados: `11002` mundo inexistente · `14006` nome de guild inválido · `9002` página de highscores bloqueada por *restriction mode*.

### Endpoints v4

| Path | Observações |
|---|---|
| `/v4/character/{name}` | Retorna `character.character`, `character.achievements`, `character.account_information`, `character.other_characters`. Nome é case-insensitive. |
| `/v4/worlds` · `/v4/world/{name}` | Lista traz `players_online`, `record_players`, `record_date` e `regular_worlds[]`. |
| `/v4/guild/{name}` · `/v4/guilds/{world}` | |
| `/v4/highscores/{world}/{category}/{vocation}/{page}` | **Só a página 1 funciona em produção** (restriction mode, erro `9002`). |
| `/v4/killstatistics/{world}` | `entries[]` com `race`, `last_day_killed`, `last_day_players_killed`, `last_week_*`. ~185 KB por mundo. |
| `/v4/creatures` · `/v4/creature/{race}` | Texto de biblioteca do tibia.com. **Não** tem loot. A lista traz as ~718 criaturas com `image_url` numa só chamada — ver "Sprites" abaixo. |
| `/v4/boostablebosses` · `/v4/fansites` · `/v4/spells` · `/v4/spell/{id}` | |
| `/v4/houses/{world}/{town}` · `/v4/house/{world}/{house_id}` | |
| `/v4/news/latest` · `/v4/news/newsticker` · `/v4/news/archive[/{days}]` · `/v4/news/id/{id}` | |

### TTL real (header `Cache-Control` das respostas)

| Recurso | `max-age` |
|---|---|
| character, house, guild, killstatistics, news | 300 s |
| creatures, spells, boostablebosses, fansites, highscores | 900 s |
| worlds | 60 s |

### Sprites de criatura

`/v4/creatures` devolve, numa única chamada, `{name, race, image_url}` das ~718 criaturas. As
imagens são GIF de **64×64** em `static.tibia.com`. Três coisas verificadas:

1. **`static.tibia.com` responde `403` para quem não é navegador.** Reproduzido com `curl`, com e
   sem `User-Agent` de navegador e com `Referer` do nosso domínio. Um `<img>` no navegador carrega
   normalmente (~150 ms). **Consequência: a URL vai crua para o `<img>` e o navegador busca.** Nada
   de `next/image`, cujo otimizador buscaria a imagem a partir do servidor e levaria 403.
2. **O nome do Hunt Analyser não casa com o `race`.** O jogo escreve `betrayed wraith` e o race é
   `wraith` — nenhuma slugificação do nome chega lá. O que casa é o **nome**, normalizando plural
   dos dois lados: `betrayed wraith` ↔ `Betrayed Wraiths`.
3. **Zero colisões** entre os 718 nomes depois de normalizados, o que autoriza usar a normalização
   no lugar de uma tabela de de-para manual. Travado em `lib/tibiadata.test.ts` contra fixture.

Implementação: `lib/nomesDeCriatura.ts` (lógica pura) e `lib/tibiadata.ts` (cliente, com
`'use cache'` + `cacheLife('days')`). Falha na API devolve mapa vazio: sprite é decoração e não
pode derrubar a tela.

### Armadilhas confirmadas

1. **Recurso inexistente devolve `502 text/plain` (corpo `error code: 502`), não JSON.** Confirmado em `/v4/character/Qqxzwv` e `/v4/creature/notacreature`, embora o swagger prometa `404 + Information`. Todo cliente precisa tolerar corpo não-JSON.
2. `400` **é** JSON válido — leia `information.status.error` em vez de confiar só no status HTTP.
3. Highscores além da página 1 é inútil em produção; não construa paginação que dependa disso.
4. `killstatistics` é o único agregado de mortes por mundo: responde "quanto se caça X", nunca "o que X dropa".

---

## 2. TibiaWikiApi (tibiawiki.dev) — dados *estáticos* do wiki

- **Base:** `https://tibiawiki.dev/api`
- **Spec:** `https://tibiawiki.dev/api-docs` — **não** `/v3/api-docs` (404). 55 paths.
- **Origem:** raspagem do TibiaWiki em `tibia.fandom.com` via jwiki. Kotlin + Spring Boot, MIT.
- **Auth:** nenhuma. `PUT` existe na spec mas está **desabilitado** na instância pública.
- **CORS:** só GET, e **apenas para `tibiawiki.dev` e origens locais**. Verificado: com `Origin`
  externo a resposta vem `200` mas **sem `Access-Control-Allow-Origin`** — o browser bloqueia.
  **Esta API só pode ser chamada do servidor.** Foi o fator que descartou SPA/Vite (diretriz 25).

### Formato — a característica que define tudo

A API devolve **os campos brutos do template do wiki**. Consequências não negociáveis:

- **Todo escalar é `string`**, inclusive números: `"hp":"1000"`, `"exp":"700"`, `"weight":"29.50"`, `"npcvalue":"40000"`.
- **Markup do wiki vem intacto**: `"[[Obsidian Knife]]"`, `"{{Ability List |{{Melee|0-120}} }}"`, `<br />`, e `"--"` como placeholder de vazio.
- Alguns campos são arrays (`"itemid":["3387"]`, `"spawntype":["Regular"]`, `"droppedby":[...]`), outros são string com separador (`"walksthrough":"Fire, Energy, Poison"`).
- `value` pode ser faixa textual: `"30,000 - 55,000"`.

### Endpoints

Padrão para ~25 categorias: `GET /api/{categoria}` (array de nomes de página) e `GET /api/{categoria}/{name}` (objeto).

`achievements` · `books` · `buildings` · `charms` · `corpses` · `creatures` · `effects` · `familiars` · `imbuements` · `items` · `keys` · `locations` · `missiles` · `mounts` · `npcs` · `objects` · `outfits` · `quests` · `spells` · `streets` · `updates` · `worlds` · `fansites` · `cipsoftmembers` · `huntingplaces`

Extras:
- `GET /api/pages/{title}` — qualquer página, sem filtro de categoria.
- `GET /api/loot/{name}` → objeto cru `{kills, name, loot[]}`.
- `GET /api/v2/loot/{name}` → mesmo dado envelopado em `{"loot2": {}}`. **Prefira v2.**
- `GET /api/huntingplaces/**` — nome com barras/parênteses vai no path livre.

### `?expand=true`

Transforma a lista de nomes em lista de objetos completos. **Teto de 5.000 páginas**; acima disso vem `413`:

```json
{"error":"expand_too_large","message":"expand requested 6560 pages; max is 5000","requested":6560,"maxPages":5000}
```

Confirmado: `/api/items?expand=true` → **413** (6560 páginas). `/api/charms?expand=true` → 200 (17 KB).
Ou seja: **itens só podem ser carregados página a página**, nunca em bloco.

### Loot stats — o dado central deste projeto

```json
{"loot2":{"kills":"16156","name":"Dragon","loot":[
  {"itemName":"Gold Coin","times":"14549","amount":"1-104","total":"549677"},
  {"itemName":"Dragon Shield","times":"49","amount":"1","total":"49"},
  {"itemName":"Empty","times":"287"}
]}}
```

- `kills` = tamanho da amostra (contribuições de jogadores, **não** dado oficial da CipSoft).
- `times` = nº de kills em que o item caiu → **drop rate = times / kills** (Dragon Shield: 49/16156 = 0,303 %).
- `amount` = faixa de quantidade por drop; `total` = soma de unidades na amostra.
- `"Empty"` é uma entrada real: kills sem loot algum. **Excluir de rankings de item.**
- A amostra é enviesada (jogadores reportam mais o que é raro ou valioso). Sempre exibir `kills` ao lado de qualquer porcentagem.

Alternativa qualitativa: `/api/creatures/{name}` traz `loot[]` com `rarity` (`common`, `uncommon`, …) — serve de fallback quando não há loot stats, mas não permite cálculo numérico.

### Limites operacionais do servidor (README do projeto)

- Cache interno de 60 s · pool de **2 threads** para I/O com o wiki · fila de **32** requisições (`503` quando cheia) · timeout de 20 s por requisição upstream.
- Latência medida: ~0,6–0,8 s por objeto, ~2 s por lista de categoria.
- **Conclusão: baixa concorrência e cache local agressivo são obrigatórios.**

### Armadilhas confirmadas

1. `404` vem com **corpo vazio** — `JSON.parse("")` explode. Cheque o status antes.
2. Títulos são normalizados como no wiki: `/api/creatures/dragon` e `/api/creatures/Dragon` funcionam; espaços viram `%20`.
3. `Items` e `Objects` foram unificados no wiki; a API mantém as duas rotas por compatibilidade e elas se sobrepõem.
4. Campos do template mudam quando o wiki muda. Não há contrato estável: campo ausente é situação normal, não erro.

---

## 3. Como as duas se complementam

| Preciso de… | Fonte |
|---|---|
| Stats de item/criatura, loot table, drop rate, quests, NPCs, hunting places | **TibiaWikiApi** |
| Personagem, guild, mundo, highscores, mortes por mundo, notícias, boss boostado | **TibiaData** |
| Preço real de Market | **Nenhuma das duas** — só `npcvalue`/`value` do wiki, que é referência de NPC |

Não há chave comum garantida: TibiaData usa slug de `race` (`dragon`), o wiki usa título de página (`Dragon`). Qualquer junção exige tabela de mapeamento própria, com fallback.

## 4. Atribuição obrigatória

Tibia e todos os produtos relacionados são © CipSoft GmbH. Qualquer interface pública deve creditar os dados de `tibia.com` (via TibiaData) e do TibiaWiki (via tibiawiki.dev).
Termos: <https://tibiadata.com/terms/>
