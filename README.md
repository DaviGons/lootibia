# lootibia

Analisador de Hunts do Tibia. Cole o texto que o Hunt Analyser copia; o app parseia, guarda a
sessão e mostra os acumulados da semana do jogo.

Next.js 16 (App Router, Cache Components) · Supabase · Tailwind · deploy na Vercel.

As regras de trabalho do projeto estão em [AGENTS.md](AGENTS.md) — leia antes de mexer.

## Rodar localmente

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sem `.env.local` preenchido o app sobe e a tela `/hunts` avisa o que falta, em vez de quebrar.

### Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (o plano Free permite 2 ativos).
2. Em *Project Settings → API*, copie a URL e a chave publicável para o `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   ```

3. Abra o *SQL Editor* e rode [`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql)
   inteiro. Ele cria as tabelas, a view de período e **todas as políticas de RLS**.
4. Crie uma conta em `/auth/sign-up` e acesse `/hunts`.

> O projeto Free é **pausado após 1 semana de inatividade**. Se a tela parar de responder, reative
> no painel do Supabase.

## Estrutura

| Caminho | O que é |
|---|---|
| `app/hunts/` | Tela do analisador: importar, listar, apagar, acumulado da semana |
| `lib/periodo.ts` | Dia e semana do jogo (server save às 10:00 de Berlim) |
| `lib/huntSession.ts` | Parser do texto do Hunt Analyser |
| `lib/huntAgregado.ts` | Agregação das métricas (`Σ total / Σ horas`) |
| `supabase/migrations/` | SQL para rodar no SQL Editor |
| `docs/` | Decisões e referências verificadas |

## Validação

Os quatro comandos da diretriz 3, todos precisam passar antes de qualquer commit:

```bash
npx tsc --noEmit
npx eslint .
npm run build
node --experimental-strip-types lib/periodo.test.ts && node --experimental-strip-types lib/hunt.test.ts
```

## Créditos

Tibia e todos os produtos relacionados são © CipSoft GmbH. Dados de [tibia.com](https://www.tibia.com)
via [TibiaData](https://tibiadata.com) e do [TibiaWiki](https://tibia.fandom.com) via
[tibiawiki.dev](https://tibiawiki.dev).
