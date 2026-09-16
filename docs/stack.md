# Stack: Supabase + Vercel + Tailwind

> Verificado na documentação oficial em 2026-09-16. Limites de plano mudam — reconferir antes de
> decisões de arquitetura que dependam deles.

---

## 1. Limites reais dos planos gratuitos

### Supabase Free

| Recurso | Limite |
|---|---|
| **Banco de dados** | **500 MB** (CPU compartilhada, 500 MB RAM) |
| File storage (bucket) | 1 GB — **contador separado do banco** |
| Egress | 5 GB + 5 GB de egress cacheado |
| Usuários ativos/mês | 50.000 |
| Projetos ativos | 2 (projetos pausados: ilimitados) |
| Backups automáticos | nenhum |
| Retenção de logs | 1 dia (API e banco), 1 h (auth audit) |
| **Inatividade** | **projeto é pausado após 1 semana sem uso** |

Dois pontos que mudam decisões:

- **O orçamento de banco é 500 MB, não 1 GB.** Todo o planejamento de schema parte desse número.
- **Pausa por inatividade é risco real** em projeto pessoal. Um cron diário que toca o banco
  mantém o projeto ativo — ver seção Vercel abaixo.

A documentação não especifica o comportamento ao estourar 500 MB. Não descobrir na prática:
monitorar e agir antes.

### Vercel Hobby

| Recurso | Limite |
|---|---|
| Deployments | 100/dia, 100/hora, 60 a cada 5 min |
| Builds concorrentes | 1 |
| Tempo de build | 45 min |
| Upload de fontes via CLI | 100 MB / 15.000 arquivos |
| **Cron jobs** | 100 por projeto, mas **no máximo 1 execução por dia cada**, precisão de ±59 min |
| Duração de função (projetos sem Fluid compute) | padrão 10 s, máximo 60 s |
| Timeout de requisição proxiada | 120 s |
| Retenção de runtime logs | 1 hora |
| Repositórios | **Hobby não conecta a repos de organização do Git**, só pessoais |
| Projetos | 200 · Domínios por projeto: 50 |

O limite de cron é o que mais pesa aqui: **expressão que rode mais de uma vez por dia falha no
deploy**, com erro explícito. Qualquer ETL periódico precisa caber em uma execução diária, dentro
do teto de 60 s de função — ou rodar fora da Vercel.

---

## 2. Supabase + Next.js

Quickstart oficial:

```bash
npx create-next-app@latest my-app -e with-supabase
```

O template já vem com TypeScript, Tailwind e **auth por cookie** configurados. Pacotes:
`@supabase/supabase-js` e `@supabase/ssr`.

Variáveis em `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=<url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chave publicável>
```

Clientes separados por contexto, criados pelo template:
- `lib/supabase/client.ts` — browser
- `lib/supabase/server.ts` — Server Components (`createClient()` é **async**, precisa de `await`)
- `lib/supabase/proxy.ts` — middleware de sessão/redirect de auth

Consulta em Server Component:

```ts
import { createClient } from "@/lib/supabase/server";

async function InstrumentsData() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("instruments").select();
  if (error) return <p>Error loading instruments: {error.message}</p>;
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

Note o padrão: envolver o componente de dados em `<Suspense>` no componente de página.

### RLS não é opcional

A chave publicável vai para o browser. Sem Row Level Security, qualquer pessoa lê e escreve a
tabela inteira. Padrão do próprio quickstart:

```sql
grant select on public.instruments to anon;
alter table instruments enable row level security;

create policy "public can read instruments"
on public.instruments
for select to anon
using (true);
```

Toda tabela criada neste projeto nasce com `enable row level security` e políticas explícitas.

---

## 3. Tailwind CSS v4

> **Decisão tomada (2026-09-16): a stack é Next.js + Tailwind via PostCSS.** O template
> `create-next-app -e with-supabase` já traz Tailwind configurado — **não instalar à mão**.
>
> ⚠️ **O template entrega Tailwind v3.4.1, não v4.** Vem com `tailwind.config.ts`,
> `autoprefixer` e o `postcss.config.mjs` no formato antigo (`plugins: { tailwindcss: {} }`).
> A seção abaixo descreve a v4, que é o que a documentação oficial mostra — **não é o que está
> instalado**. Migrar para v4 é opção em aberto, não pendência.

**Com Vite (descartado):**

```bash
npm install tailwindcss @tailwindcss/vite
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({ plugins: [tailwindcss()] })
```

```css
@import "tailwindcss";
```

Diferenças da v3 que importam: **não existe mais `tailwind.config.js` obrigatório** nem as
diretivas `@tailwind base/components/utilities` — a configuração é feita no próprio CSS a partir do
`@import`.

⚠️ **O guia de Vite não se aplica aqui.** Em Next.js o plugin é `@tailwindcss/postcss`, não
`@tailwindcss/vite`, e o template `-e with-supabase` já traz tudo configurado.

O motivo do descarte do Vite está na diretriz 25 e em `tibia-apis.md`: a TibiaWikiApi não libera
CORS para origens externas, então um SPA não alcança a API de loot sem um proxy de servidor.

---

## 4. Vercel — o que importa para este projeto

- **Deploy por Git**: push na branch → preview URL; merge na principal → produção.
- **ISR** (Incremental Static Regeneration): regenera páginas estáticas sob demanda ou por tempo,
  sem rebuild completo. É o mecanismo certo para páginas derivadas de dados de wiki que mudam pouco
  — evita tanto requisição por usuário quanto armazenamento no banco.
- **Environment variables**: até 1000 por ambiente, 64 KB no total. Segredos nunca em `NEXT_PUBLIC_*`.
- **Instant Rollback**: reverte produção para um deploy anterior sem rebuild.
- CLI: `npm i -g vercel`, `vercel login`, `vercel`.
