import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ptBRCommon from '../locales/pt-BR/common.json';
import ptBRAuth from '../locales/pt-BR/auth.json';
import ptBRAdmin from '../locales/pt-BR/admin.json';
import ptBRCrm from '../locales/pt-BR/crm.json';
import enUSCommon from '../locales/en-US/common.json';
import enUSAuth from '../locales/en-US/auth.json';
import enUSAdmin from '../locales/en-US/admin.json';
import enUSCrm from '../locales/en-US/crm.json';
import esCommon from '../locales/es/common.json';
import esAuth from '../locales/es/auth.json';
import esAdmin from '../locales/es/admin.json';
import esCrm from '../locales/es/crm.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'pt-BR': { common: ptBRCommon, auth: ptBRAuth, admin: ptBRAdmin, crm: ptBRCrm },
      'en-US': { common: enUSCommon, auth: enUSAuth, admin: enUSAdmin, crm: enUSCrm },
      es: { common: esCommon, auth: esAuth, admin: esAdmin, crm: esCrm },
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
