import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { LegalDpoLink } from '../../components/legal/LegalDpoLink';
import { legalApi } from '../../services/api';

type LegalDocumentType = 'terms' | 'privacy';

interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

interface LegalDocumentPageProps {
  type: LegalDocumentType;
}

const LAST_UPDATED = '8 de junho de 2026';

const termsSections: LegalSection[] = [
  {
    title: '1. Aceitação dos termos',
    paragraphs: [
      'Ao acessar ou utilizar o ZiraDesk, o usuário declara que leu, compreendeu e concorda com estes Termos de Uso. Caso não concorde, não deve utilizar a plataforma.',
      'Estes termos se aplicam aos administradores, agentes, supervisores e demais usuários autorizados pela empresa contratante.',
    ],
  },
  {
    title: '2. Uso da plataforma',
    items: [
      'O ZiraDesk deve ser utilizado apenas para finalidades lícitas e relacionadas à operação de atendimento, CRM, tickets, campanhas e gestão de relacionamento com clientes.',
      'O usuário é responsável por manter suas credenciais em sigilo e por todas as ações realizadas em sua conta.',
      'É proibido tentar acessar dados, contas, integrações ou ambientes para os quais o usuário não tenha autorização.',
      'A empresa contratante é responsável por configurar permissões, canais, mensagens, templates, retenção de dados e bases legais aplicáveis à sua operação.',
    ],
  },
  {
    title: '3. Canais, integrações e terceiros',
    paragraphs: [
      'A plataforma pode se integrar a serviços de terceiros, incluindo provedores de mensagens, telefonia, e-mail, inteligência artificial, gateways e APIs externas.',
      'O funcionamento desses serviços depende das regras, disponibilidade, limites, políticas e aprovações de cada fornecedor. O usuário deve respeitar as políticas dos canais utilizados, incluindo WhatsApp Business Platform e demais serviços integrados.',
    ],
  },
  {
    title: '4. Conteúdos, mensagens e campanhas',
    items: [
      'A empresa contratante é responsável pelo conteúdo enviado por seus usuários, automações, campanhas e integrações.',
      'Mensagens comerciais, templates e disparos ativos devem observar consentimento, base legal, opt-out, regras do canal e legislação aplicável.',
      'O ZiraDesk pode bloquear, limitar ou remover usos que comprometam segurança, disponibilidade, reputação do serviço ou cumprimento regulatório.',
    ],
  },
  {
    title: '5. Dados e segurança',
    paragraphs: [
      'O ZiraDesk adota medidas técnicas e organizacionais para proteger informações tratadas na plataforma. Nenhum sistema, entretanto, é imune a riscos operacionais, falhas de terceiros ou uso indevido de credenciais.',
      'A empresa contratante deve orientar seus usuários, revisar permissões, manter integrações atualizadas e comunicar incidentes conforme suas obrigações legais e contratuais.',
    ],
  },
  {
    title: '6. Propriedade intelectual',
    paragraphs: [
      'A plataforma, interfaces, marcas, componentes, documentação, código e demais elementos do ZiraDesk pertencem aos seus respectivos titulares. O uso do sistema não transfere direitos de propriedade intelectual ao usuário ou à empresa contratante.',
    ],
  },
  {
    title: '7. Disponibilidade e alterações',
    paragraphs: [
      'O ZiraDesk poderá evoluir funcionalidades, corrigir falhas, alterar fluxos, atualizar integrações e realizar manutenções. Sempre que possível, mudanças relevantes serão comunicadas pelos canais oficiais.',
      'Também poderemos atualizar estes Termos de Uso. A versão vigente ficará disponível nesta página, com a respectiva data de atualização.',
    ],
  },
  {
    title: '8. Contato',
    paragraphs: [
      'Dúvidas sobre estes termos, privacidade ou tratamento de dados podem ser encaminhadas pelo canal do Encarregado de Dados disponível nesta página, quando configurado pela empresa responsável.',
    ],
  },
];

const privacySections: LegalSection[] = [
  {
    title: '1. Objetivo',
    paragraphs: [
      'Esta Política de Privacidade explica como dados pessoais podem ser tratados no ZiraDesk durante o uso da plataforma por empresas, usuários internos, contatos, clientes e titulares de dados.',
      'A política foi elaborada com foco na Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 - LGPD), que protege direitos fundamentais de liberdade, privacidade e desenvolvimento da personalidade da pessoa natural.',
    ],
  },
  {
    title: '2. Dados pessoais tratados',
    items: [
      'Dados cadastrais, como nome, e-mail, telefone, cargo, organização, documento e identificadores de contato.',
      'Dados de atendimento, como mensagens, protocolos, histórico de conversas, arquivos, avaliações, motivos de encerramento e registros de fila.',
      'Dados de uso e segurança, como autenticação, permissões, logs de acesso, eventos de auditoria, endereço IP, dispositivo e registros técnicos.',
      'Dados configurados pela empresa contratante em integrações, canais, automações, templates, campanhas, tickets e formulários.',
    ],
  },
  {
    title: '3. Finalidades do tratamento',
    items: [
      'Autenticar usuários e controlar permissões de acesso.',
      'Operar atendimentos, tickets, campanhas, filas, automações e integrações de comunicação.',
      'Registrar histórico, auditoria, métricas, relatórios, qualidade, segurança e prevenção de uso indevido.',
      'Cumprir obrigações legais, regulatórias, contratuais e solicitações de titulares.',
      'Melhorar a plataforma, corrigir falhas, prestar suporte e manter disponibilidade do serviço.',
    ],
  },
  {
    title: '4. Bases legais',
    paragraphs: [
      'As bases legais podem variar conforme a operação da empresa contratante e a finalidade do tratamento. Entre as bases aplicáveis podem estar execução de contrato, cumprimento de obrigação legal ou regulatória, legítimo interesse, consentimento, exercício regular de direitos e proteção do crédito, quando cabível.',
      'A empresa contratante deve avaliar e documentar as bases legais aplicáveis aos dados que insere, importa ou trata por meio do ZiraDesk.',
    ],
  },
  {
    title: '5. Compartilhamento de dados',
    paragraphs: [
      'Dados podem ser compartilhados com fornecedores necessários à operação da plataforma, como provedores de infraestrutura, mensageria, e-mail, telefonia, armazenamento, análise, inteligência artificial e gateways de terceiros.',
      'Também pode haver compartilhamento quando exigido por lei, autoridade competente, obrigação contratual, defesa de direitos ou solicitação da empresa contratante.',
    ],
  },
  {
    title: '6. Retenção e segurança',
    paragraphs: [
      'Os dados são mantidos pelo período necessário para cumprir as finalidades descritas, observadas configurações de retenção, obrigações legais, auditoria, prevenção a fraudes e exercício regular de direitos.',
      'A plataforma utiliza controles de acesso, autenticação, segregação por tenant, registros de auditoria e medidas técnicas compatíveis com o risco da operação. A segurança também depende do uso adequado por administradores e usuários autorizados.',
    ],
  },
  {
    title: '7. Direitos dos titulares',
    paragraphs: [
      'Nos termos da LGPD, titulares podem solicitar confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação, portabilidade, informação sobre compartilhamento, revisão de decisões automatizadas e revogação de consentimento, quando aplicável.',
      'As solicitações podem ser realizadas pelos canais de privacidade disponíveis no sistema ou pelo contato do Encarregado de Dados, quando configurado.',
    ],
  },
  {
    title: '8. Cookies e tecnologias semelhantes',
    paragraphs: [
      'O ZiraDesk pode utilizar tecnologias necessárias para autenticação, sessão, segurança, preferências de tema, funcionamento da interface e melhoria operacional. Cookies estritamente necessários são essenciais para o uso seguro do sistema.',
    ],
  },
  {
    title: '9. Atualizações desta política',
    paragraphs: [
      'Esta Política de Privacidade pode ser atualizada para refletir mudanças legais, operacionais, técnicas ou contratuais. A versão vigente ficará disponível nesta página, com a data de atualização.',
    ],
  },
];

export function LegalDocumentPage({ type }: LegalDocumentPageProps) {
  const { data } = useQuery({
    queryKey: ['legal', 'dpo'],
    queryFn: legalApi.getDpo,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const isPrivacy = type === 'privacy';
  const title = isPrivacy ? 'Política de Privacidade' : 'Termos de Uso';
  const subtitle = isPrivacy
    ? 'Como o ZiraDesk trata dados pessoais, protege informações e apoia o atendimento aos direitos dos titulares.'
    : 'Condições para acesso e uso do ZiraDesk por empresas, administradores, agentes e usuários autorizados.';
  const sections = isPrivacy ? privacySections : termsSections;
  const relatedLink = isPrivacy
    ? { to: '/termos-de-uso', label: 'Ver Termos de Uso' }
    : { to: '/politica-de-privacidade', label: 'Ver Política de Privacidade' };
  const hasDpoInfo = Boolean(data?.name || data?.email || data?.phone || data?.privacyPolicyUrl || data?.termsUrl);

  const companyName = useMemo(
    () => data?.companyLegalName?.trim() || 'ZiraDesk',
    [data?.companyLegalName],
  );

  return (
    <div className="legal-page">
      <header className="legal-page-topbar">
        <Link to="/login" className="legal-page-brand" aria-label="Ir para o login">
          <BrandLogo width={132} height={30} />
        </Link>
        <div className="legal-page-topbar-actions">
          <Link to={relatedLink.to} className="tb-btn">
            {relatedLink.label}
          </Link>
          <Link to="/login" className="tb-btn tb-btn-primary">
            Entrar
          </Link>
        </div>
      </header>

      <main className="legal-page-main">
        <article className="legal-document">
          <div className="legal-document-eyebrow">Documento legal</div>
          <h1>{title}</h1>
          <p className="legal-document-subtitle">{subtitle}</p>

          <div className="legal-document-meta">
            <span>Última atualização: {LAST_UPDATED}</span>
            <span aria-hidden>•</span>
            <span>Responsável: {companyName}</span>
            {data?.companyCnpj ? (
              <>
                <span aria-hidden>•</span>
                <span>CNPJ: {data.companyCnpj}</span>
              </>
            ) : null}
          </div>

          {sections.map((section) => (
            <section key={section.title} className="legal-document-section">
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items ? (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <section className="legal-document-section">
            <h2>{isPrivacy ? '10. Encarregado de Dados' : '9. Encarregado de Dados'}</h2>
            <p>
              Quando configurado, o contato do Encarregado de Dados pode ser consultado pelo botão abaixo.
            </p>
            {hasDpoInfo ? (
              <LegalDpoLink className="legal-document-dpo-link" />
            ) : (
              <p>Nenhum contato de Encarregado de Dados foi configurado para exibição pública.</p>
            )}
          </section>
        </article>
      </main>
    </div>
  );
}

export function TermsOfUsePage() {
  return <LegalDocumentPage type="terms" />;
}

export function PrivacyPolicyPage() {
  return <LegalDocumentPage type="privacy" />;
}
