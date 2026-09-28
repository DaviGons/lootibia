import Link from "next/link";
import { Folder, Inbox, Layers, PackageSearch, TrendingUp } from "lucide-react";
import { Marca } from "@/components/marca";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { progressoDaMeta, type UnidadeDaMeta } from "@/lib/meta";
import { NovaPasta, EditarPasta } from "@/components/pasta-form";
import { OrdenarPastas } from "@/components/ordenar-pastas";
import { Gaveta } from "@/components/gaveta";
import { GrupoDaLateral, LinkDaLateral } from "@/components/link-da-lateral";
import { BotaoNovaHunt, JanelaDeImportacao } from "@/components/importar-hunt";
import type { CharDoSeletor } from "@/app/(app)/hunts/formulario";

export interface PastaNaLateral {
  id: number;
  nome: string;
  hunts: number;
  profit: number;
  meta_valor: number | null;
  meta_unidade: UnidadeDaMeta | null;
}

/**
 * Navegação do app, em três grupos:
 *
 * - **Analyzers** — o núcleo: todas as hunts, as pastas e a importação.
 * - **Ferramentas** — o que analisa algo que o jogador traz (o stash, por ora
 *   só anunciado).
 * - **Calculadoras** — o que calcula a partir de números.
 *
 * Mora no layout de `app/(app)`, e por isso aparece em toda página logada. Não
 * sabe qual página está aberta: quem destaca o item ativo é `LinkDaLateral`,
 * no navegador.
 */
export function Lateral({
  pastas,
  totalDeHunts,
  semPasta,
  precoTc,
  usuario,
  chars,
}: {
  pastas: PastaNaLateral[];
  totalDeHunts: number;
  semPasta: number;
  precoTc: number | null;
  usuario: string | null;
  chars: CharDoSeletor[];
}) {
  return (
    <Gaveta>
      <aside className="flex h-dvh w-[238px] shrink-0 flex-col gap-5 overflow-y-auto border-r bg-secondary/40 p-3 lg:sticky lg:top-0">
        <Link href="/hunts" className="px-2 pt-0.5 text-foreground" aria-label="lootibia — início">
          <Marca altura={21} />
        </Link>

        <GrupoDaLateral id="analyzers" titulo="Analyzers">
          <ItemDaLateral href="/hunts" contagem={totalDeHunts} icone={<Layers />}>
            Todas as hunts
          </ItemDaLateral>

          <h3 className="mb-0.5 mt-2 flex items-center px-2.5 text-[11px] text-muted-foreground">
            Pastas
            <NovaPasta />
          </h3>

          {pastas.length === 0 && (
            <p className="px-2.5 py-1 text-xs leading-relaxed text-muted-foreground">
              Nenhuma pasta ainda. Crie uma para agrupar hunts por campanha e pôr uma meta.
            </p>
          )}

          {pastas.map((p) => {
            const meta =
              p.meta_valor && p.meta_unidade
                ? progressoDaMeta({ valor: p.meta_valor, unidade: p.meta_unidade }, p.profit, precoTc, p.hunts)
                : null;
            return (
              <ItemDaLateral
                key={p.id}
                href={`/hunts?pasta=${p.id}`}
                contagem={p.hunts}
                barra={meta?.fracao}
                acao={
                  <>
                    <OrdenarPastas ids={pastas.map((x) => x.id)} atual={p.id} />
                    <EditarPasta pasta={p} />
                  </>
                }
                icone={<Folder />}
              >
                {p.nome}
              </ItemDaLateral>
            );
          })}

          {semPasta > 0 && (
            <ItemDaLateral href="/hunts?pasta=sem" contagem={semPasta} icone={<Inbox />}>
              Sem pasta
            </ItemDaLateral>
          )}

          <div className="mt-1">
            <BotaoNovaHunt />
          </div>
        </GrupoDaLateral>

        <GrupoDaLateral id="ferramentas" titulo="Ferramentas">
          <EmBreve icone={<PackageSearch />}>Stash analyzer</EmBreve>
        </GrupoDaLateral>

        <GrupoDaLateral id="calculadoras" titulo="Calculadoras">
          <ItemDaLateral href="/calculadoras/level" icone={<TrendingUp />}>
            Prever level
          </ItemDaLateral>
        </GrupoDaLateral>

        <div className="mt-auto flex flex-col gap-0.5 border-t pt-2.5">
          {usuario && (
            <span className="px-2.5 py-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{usuario}</span>
            </span>
          )}
          <ItemDaLateral href="/config">Configurações</ItemDaLateral>
          <div className="flex items-center gap-1 px-1">
            <ThemeSwitcher />
            <LogoutButton />
          </div>
        </div>
      </aside>

      <JanelaDeImportacao chars={chars} />
    </Gaveta>
  );
}

/** Ferramenta anunciada e ainda não feita: aparece, mas não leva a lugar nenhum. */
function EmBreve({ icone, children }: { icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      aria-disabled
      className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground/60"
    >
      <span aria-hidden className="shrink-0 [&>svg]:h-[14px] [&>svg]:w-[14px]">
        {icone}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="rounded-full border px-1.5 text-[10px] leading-4">em breve</span>
    </span>
  );
}

/**
 * Uma linha da lateral. `barra` é o progresso da meta, 0 a 1.
 *
 * O fio de 3px vive fora do flex da linha para não brigar por espaço com o
 * nome e a contagem — e por isso o `<span>` que o envolve é `block`: span é
 * inline por padrão e ignoraria a altura, o que já me custou uma versão do
 * protótipo com a barra invisível.
 */
function ItemDaLateral({
  href,
  contagem,
  barra,
  acao,
  icone,
  children,
}: {
  href: string;
  contagem?: number;
  barra?: number;
  /** Botão que vive dentro da linha (editar), revelado no hover. */
  acao?: React.ReactNode;
  /**
   * Ícone do lucide. Vem por prop e não entre os `children` de propósito: junto
   * do texto ele ficava DENTRO do mesmo span, e o `gap` do flex separava o
   * conjunto da contagem — nunca o ícone da palavra. Era o que os deixava
   * colados.
   */
  icone?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LinkDaLateral
      href={href}
      base="group/pasta block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors"
      seAtivo="bg-primary/10 font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]"
      seInativo="text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <span className="flex w-full items-center gap-2.5">
        {/* `[&>svg]` dimensiona o ícone sem o chamador precisar saber disso:
            14px, traço de 2 e alinhado ao texto de 13px. */}
        {icone && (
          <span
            aria-hidden
            className="shrink-0 text-muted-foreground [&>svg]:h-[14px] [&>svg]:w-[14px]"
          >
            {icone}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {acao}
        {contagem !== undefined && (
          <span className="text-[11px] tabular-nums text-muted-foreground">{contagem}</span>
        )}
      </span>
      {barra !== undefined && (
        <span className="ml-[24px] mt-1.5 block h-[3px] overflow-hidden rounded-full bg-[hsl(var(--dado-trilho))]">
          <span
            className="block h-full rounded-full bg-[hsl(var(--dado))]"
            style={{ width: `${Math.round(barra * 100)}%` }}
          />
        </span>
      )}
    </LinkDaLateral>
  );
}
