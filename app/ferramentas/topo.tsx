import Link from "next/link";
import { Marca } from "@/components/marca";

/** Cabeçalho das páginas de ferramenta: marca à esquerda, volta à direita. */
export function Topo({ voltarPara = "/hunts", rotulo = "Voltar ao painel" }: { voltarPara?: string; rotulo?: string }) {
  return (
    <div className="mb-10 flex items-center justify-between gap-4">
      <Link href="/hunts" className="text-foreground" aria-label="lootibia — início">
        <Marca altura={22} />
      </Link>
      <Link
        href={voltarPara}
        className="rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {rotulo}
      </Link>
    </div>
  );
}
