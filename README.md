<p align="center">
  <img src="app/opengraph-image.png" width="620" alt="lootibia">
</p>

<p align="center">
  Analisador de hunts do Tibia — pelo site ou por um bot do Discord.<br>
  <a href="https://lootibia.vercel.app">lootibia.vercel.app</a>
</p>

---

Cole o texto que o Hunt Analyser do Tibia copia. O app parseia, guarda a sessão e mostra os
acumulados da **semana do jogo** — que não é a semana do calendário: ela vira às 10:00 de Berlim,
no server save.

Next.js 16 (App Router, Cache Components) · Supabase · Tailwind · Vercel.

> **Projeto pessoal, de uso fechado.** Não há cadastro aberto: as contas são criadas à mão. O
> código está público, a instância não.

As regras de trabalho estão em **[AGENTS.md](AGENTS.md)** — 40 diretrizes, cada uma com o motivo
junto. Leia antes de mexer.

## Duas regras de cálculo que não se negociam

- **Toda taxa é `Σ total / Σ horas`**, nunca a média das médias por sessão. Uma hunt de 10 min com
  XP/h inflado pesaria igual a uma de 4 h. No caso real testado a diferença foi de 120 mil/h contra
  350 mil/h.
- **`Balance` e as taxas `/h` do texto não se persistem.** `Balance` é `Loot − Supplies`, e os `/h`
  do jogo não são reproduzíveis por nenhuma duração única.

## Rodar localmente

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sem `.env.local` preenchido o app sobe mesmo assim, e a tela `/hunts` diz o que falta em vez de
quebrar.

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em *Project Settings → API*, copie a URL e a **chave publicável** para o `.env.local`.
3. No *SQL Editor*, rode os dois migrations na ordem:
   [`0001_schema.sql`](supabase/migrations/0001_schema.sql) e
   [`0002_bot_discord.sql`](supabase/migrations/0002_bot_discord.sql). Eles criam as tabelas, a
   view de período e **todas as políticas de RLS**.
4. Em *Authentication → Sign In / Providers*, **desligue "Allow new users to sign up"**. Não é
   detalhe: sem isso o endpoint do GoTrue aceita cadastro de quem souber o caminho, mesmo sem tela.

> O plano Free **pausa o projeto após 1 semana de inatividade**.

### 2. Criar uma conta

Não existe tela de cadastro. Ponha a chave **secreta** em `SUPABASE_SECRET_KEY` no `.env.local` —
[nunca na Vercel](AGENTS.md) — e rode:

```bash
node --experimental-strip-types --env-file=.env.local scripts/criar-usuario.ts davi
```

Ele imprime o usuário e um **código de ativação**, que funciona como senha temporária. No primeiro
acesso o site obriga a trocar por uma senha de verdade. `--resetar` sorteia um código novo para
quem esqueceu a senha; `--listar` mostra quem já trocou.

O modelo completo, com os porquês, está em [`lib/conta.ts`](lib/conta.ts).

### 3. Bot do Discord (opcional)

Montagem passo a passo em [`docs/bot-discord.md`](docs/bot-discord.md). Ele roda como HTTP
Interactions no **mesmo deploy da Vercel** — não há processo nem host a mais.

## Estrutura

| Caminho | O que é |
|---|---|
| `app/hunts/` | Tela do analisador: importar, listar, apagar, acumulado da semana |
| `app/api/discord/` | Endpoint de interações do bot (`/cadastro`, `/addhunt`, `/viewstats`) |
| `lib/huntSession.ts` | Parser do texto do Hunt Analyser |
| `lib/huntAgregado.ts` | Agregação das métricas (`Σ total / Σ horas`) |
| `lib/periodo.ts` | Dia e semana do jogo, com o DST de Berlim resolvido |
| `lib/conta.ts` | Login por usuário, código de ativação, domínio sintético |
| `lib/sprites.ts` · `lib/dados/` | Sprite de criatura, de um arquivo versionado — sem API na requisição |
| `lib/marca.ts` · `components/marca.tsx` | A marca, desenhada em vetor (sem fonte) |
| `scripts/` | Ferramentas de linha de comando, rodadas à mão |
| `supabase/migrations/` | SQL para o SQL Editor |
| `docs/` | Decisões e referências **verificadas contra as APIs de verdade** |

## Validação

Tudo tem de passar antes de qualquer commit (diretriz 3):

```bash
npx tsc --noEmit
npx eslint .
npm run build
node --experimental-strip-types lib/periodo.test.ts
node --experimental-strip-types lib/hunt.test.ts
node --experimental-strip-types lib/sprites.test.ts
node --experimental-strip-types lib/discord.test.ts
node --experimental-strip-types lib/marca.test.ts
node --experimental-strip-types lib/conta.test.ts
```

Os testes não usam framework: rodam com `node --experimental-strip-types` e comparam com
`JSON.stringify`. Nenhum deles toca a rede — os parsers são testados contra respostas reais
gravadas em `test/fixtures/` (diretriz 29).

## Créditos

Tibia e todos os produtos relacionados são © CipSoft GmbH. Este projeto não é afiliado à CipSoft.
Dados de [tibia.com](https://www.tibia.com) via [TibiaData](https://tibiadata.com) e do
[TibiaWiki](https://tibia.fandom.com) via [tibiawiki.dev](https://tibiawiki.dev).
