import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ptBRCommon from '../locales/pt-BR/common.json';
import ptBRAuth from '../locales/pt-BR/auth.json';
import ptBRAdmin from '../locales/pt-BR/admin.json';
import ptBRCrm from '../locales/pt-BR/crm.json';
import ptBRTickets from '../locales/pt-BR/tickets.json';
import ptBROmnichannel from '../locales/pt-BR/omnichannel.json';
import ptBRPortal from '../locales/pt-BR/portal.json';
import ptBRLegal from '../locales/pt-BR/legal.json';
import enUSCommon from '../locales/en-US/common.json';
import enUSAuth from '../locales/en-US/auth.json';
import enUSAdmin from '../locales/en-US/admin.json';
import enUSCrm from '../locales/en-US/crm.json';
import enUSTickets from '../locales/en-US/tickets.json';
import enUSOmnichannel from '../locales/en-US/omnichannel.json';
import enUSPortal from '../locales/en-US/portal.json';
import enUSLegal from '../locales/en-US/legal.json';
import esCommon from '../locales/es/common.json';
import esAuth from '../locales/es/auth.json';
import esAdmin from '../locales/es/admin.json';
import esCrm from '../locales/es/crm.json';
import esTickets from '../locales/es/tickets.json';
import esOmnichannel from '../locales/es/omnichannel.json';
import esPortal from '../locales/es/portal.json';
import esLegal from '../locales/es/legal.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'pt-BR': { common: ptBRCommon, auth: ptBRAuth, admin: ptBRAdmin, crm: ptBRCrm, tickets: ptBRTickets, omnichannel: ptBROmnichannel, portal: ptBRPortal, legal: ptBRLegal },
      'en-US': { common: enUSCommon, auth: enUSAuth, admin: enUSAdmin, crm: enUSCrm, tickets: enUSTickets, omnichannel: enUSOmnichannel, portal: enUSPortal, legal: enUSLegal },
      es: { common: esCommon, auth: esAuth, admin: esAdmin, crm: esCrm, tickets: esTickets, omnichannel: esOmnichannel, portal: esPortal, legal: esLegal },
    },
    fallbackLng: 'pt-BR',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
