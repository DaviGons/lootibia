import type { NextConfig } from "next";

/**
 * Headers de segurança, em toda rota.
 *
 * Até 2026-09-27 o site só mandava o HSTS que a Vercel põe sozinha: qualquer
 * página podia ser aberta dentro de um `<iframe>` alheio, com o botão de
 * apagar hunt debaixo de um clique induzido.
 *
 * A CSP é de propósito MÍNIMA. Uma política que controle `script-src` exige
 * nonce por requisição, e o próprio guia do Next instalado é explícito: nonce
 * obriga renderização dinâmica — o que desfaria as páginas estáticas e o
 * shell pré-renderizado de /hunts (diretriz 32). Sobram as diretivas que não
 * tocam em script nenhum: ninguém nos emoldura, ninguém troca a `<base>`,
 * formulário só envia para cá, e nada de `<object>`.
 */
const SEGURANCA = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  // O mesmo que `frame-ancestors`, para navegador que não lê CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,

  async headers() {
    return [{ source: "/:path*", headers: SEGURANCA }];
  },

  // A raiz e o analisador. Redirect no roteamento, nao com `redirect()` dentro
  // de uma pagina: no Next 16 isso impede a validacao de navegacao instantanea
  // e enche o log de "Could not validate `instant`" a cada requisicao.
  async redirects() {
    return [{ source: "/", destination: "/hunts", permanent: false }];
  },
};

export default nextConfig;
