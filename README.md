<p align="center">
  <img src="app/opengraph-image.png" width="620" alt="lootibia">
</p>

<p align="center">
  Analisador de hunts do Tibia.<br>
  <a href="https://lootibia.vercel.app">lootibia.vercel.app</a>
</p>

---

Cole o texto que o Hunt Analyser do Tibia copia. O app parseia, guarda a sessão e mostra os
acumulados: profit, loot, supplies, XP e XP Raw, mobs mortos e as hunts mais caçadas.

Quem organiza é a **pasta** — criada e nomeada por você, com **meta opcional em Tibia Coin ou em
gold**. A meta guarda valor e unidade, nunca o equivalente em gold, porque o preço da TC muda.

Next.js 16 (App Router, Cache Components) · Supabase · Tailwind · Vercel.

> **Projeto pessoal, de uso fechado.** Não há cadastro aberto: as contas são criadas à mão. O
> código está público, a instância não.

As regras de trabalho estão em **[AGENTS.md](AGENTS.md)** — 43 diretrizes, cada uma com o motivo
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
3. No *SQL Editor*, rode os três migrations **na ordem**:
   [`0001_schema.sql`](supabase/migrations/0001_schema.sql),
   [`0002_personagem_e_perfil.sql`](supabase/migrations/0002_personagem_e_perfil.sql) e
   [`0003_pastas_e_metas.sql`](supabase/migrations/0003_pastas_e_metas.sql).
   Eles criam as tabelas, a view de período e **todas as políticas de RLS**.
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

## Estrutura

| Caminho | O que é |
|---|---|
| `app/hunts/` | Tela do analisador: importar, listar, apagar, organizar em pastas |
| `app/config/` | Personagens, preço da Tibia Coin por mundo, troca de senha |
| `lib/huntSession.ts` | Parser do texto do Hunt Analyser |
| `lib/huntAgregado.ts` | Agregação das métricas (`Σ total / Σ horas`) |
| `lib/importacao.ts` | Uma sessão parseada indo para o banco, sem nenhuma linha de Next |
| `lib/meta.ts` | Progresso da meta da pasta e conversão TC ↔ gp |
| `lib/periodo.ts` | Dia e semana do jogo, com o DST de Berlim resolvido |
| `lib/rashid.ts` | Onde o Rashid está hoje — rotação versionada, respeitando o server save |
| `lib/tibiadata.ts` | Cliente único da TibiaData: personagem, mundo, boostados do dia |
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
node --experimental-strip-types lib/marca.test.ts
node --experimental-strip-types lib/conta.test.ts
node --experimental-strip-types lib/metaRashid.test.ts
node --experimental-strip-types lib/moedas.test.ts
```

Os testes não usam framework: rodam com `node --experimental-strip-types` e comparam com
`JSON.stringify`. Nenhum deles toca a rede — os parsers são testados contra respostas reais
gravadas em `test/fixtures/` (diretriz 29).

Fora dessa lista, porque precisa de credencial e de rede:

```bash
node --experimental-strip-types --env-file=.env.local scripts/testar-pastas.ts
```

Ele fala com o banco de verdade, autenticado como um usuário de verdade, e existe por causa de uma
classe de bug que nenhum teste de unidade pega: **RLS sem política de `update` nega em silêncio, e
o PostgREST ainda responde `200`** (diretrizes 45 e 46). Rode-o sempre que mexer em política.

## Créditos

Tibia e todos os produtos relacionados são © CipSoft GmbH. Este projeto não é afiliado à CipSoft.
Dados de [tibia.com](https://www.tibia.com) via [TibiaData](https://tibiadata.com) e do
[TibiaWiki](https://tibia.fandom.com) via [tibiawiki.dev](https://tibiawiki.dev).
