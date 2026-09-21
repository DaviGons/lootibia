import Link from "next/link";
import { Folder, Inbox, Layers } from "lucide-react";
import { Marca } from "@/components/marca";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { progressoDaMeta, type UnidadeDaMeta } from "@/lib/meta";
import { NovaPasta, EditarPasta } from "@/components/pasta-form";
import { OrdenarPastas } from "@/components/ordenar-pastas";
import { Gaveta } from "@/components/gaveta";

export interface PastaNaLateral {
  id: number;
  nome: string;
  hunts: number;
  profit: number;
  meta_valor: number | null;
  meta_unidade: UnidadeDaMeta | null;
}

/**
 * Navegação do app. Pastas criadas pelo usuário, na ordem que ele definiu.
 *
 * Não há mais lista de períodos aqui. Ela misturava granularidades que se
 * sobrepunham — "semana atual" e "este mês" ao mesmo tempo — e era navegação
 * fingindo ser filtro. O recorte por tempo virou um controle único na barra
 * de cima; a lateral responde só "qual conjunto de hunts".
 */
export function Lateral({
  pastas,
  selecionada,
  totalDeHunts,
  semPasta,
  precoTc,
  usuario,
}: {
  pastas: PastaNaLateral[];
  selecionada: string | null;
  totalDeHunts: number;
  semPasta: number;
  precoTc: number | null;
  usuario: string | null;
}) {
  return (
    <Gaveta>
      <aside className="flex h-dvh w-[238px] shrink-0 flex-col gap-5 overflow-y-auto border-r bg-secondary/40 p-3 lg:sticky lg:top-0">
      <Link href="/hunts" className="px-2 pt-0.5 text-foreground" aria-label="lootibia — início">
        <Marca altura={21} />
      </Link>

      <div>
        <ItemDaLateral
          href="/hunts"
          ativo={selecionada === null}
          contagem={totalDeHunts}
          icone={<Layers />}
        >
          Todas as hunts
        </ItemDaLateral>
      </div>

      <div>
        <h2 className="mb-1.5 flex items-center px-2 text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted-foreground">
          Pastas
          <NovaPasta />
        </h2>

        {pastas.length === 0 && (
          <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
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
              ativo={selecionada === String(p.id)}
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
          <ItemDaLateral
            href="/hunts?pasta=sem"
            ativo={selecionada === "sem"}
            contagem={semPasta}
            icone={<Inbox />}
          >
            Sem pasta
          </ItemDaLateral>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-0.5 border-t pt-2.5">
        {usuario && (
          <span className="px-2.5 py-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{usuario}</span>
          </span>
        )}
        <Link
          href="/config"
          className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Configurações
        </Link>
        <div className="flex items-center gap-1 px-1">
          <ThemeSwitcher />
          <LogoutButton />
        </div>
      </div>
      </aside>
    </Gaveta>
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
  ativo,
  contagem,
  barra,
  acao,
  icone,
  children,
}: {
  href: string;
  ativo: boolean;
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
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`group/pasta block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
        ativo
          ? "bg-primary/10 font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
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
    </Link>
  );
}
