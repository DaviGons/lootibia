import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Casa com tudo, menos:
     * - _next/static (arquivos estáticos)
     * - _next/image (otimização de imagem)
     * - favicon.ico
     * - imagens — .svg, .png, .jpg, .jpeg, .gif, .webp
     *
     * Uma lição que já custou caro aqui, e vale para a próxima rota pública:
     * este proxy manda quem não tem sessão para `/auth/login`. Um endpoint
     * chamado por terceiro — que não manda cookie nenhum — leva `307` e nunca
     * roda, e o sintoma do outro lado costuma ser mudo. Rota que precise ser
     * pública tem de sair deste matcher.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
