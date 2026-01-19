export const translations = {
  en: {
    'welcome.back': 'Welcome Back',
    'signin.description': 'Sign in to your account to continue',
    'email.label': 'Email',
    'password.label': 'Password',
    'signin.button': 'Sign In',
    'show.password': 'Show password',
    'hide.password': 'Hide password',
    'nav.tenants': 'Tenants',
    'nav.channels': 'Channels',
    'nav.api-keys': 'API Keys',
    'nav.members': 'Members',
    'sign.out': 'Sign out',
  },
  es: {
    'welcome.back': 'Bienvenido de nuevo',
    'signin.description': 'Inicia sesión en tu cuenta para continuar',
    'email.label': 'Correo electrónico',
    'password.label': 'Contraseña',
    'signin.button': 'Iniciar sesión',
    'show.password': 'Mostrar contraseña',
    'hide.password': 'Ocultar contraseña',
    'nav.tenants': 'Inquilinos',
    'nav.channels': 'Canales',
    'nav.api-keys': 'Claves de API',
    'nav.members': 'Miembros',
    'sign.out': 'Cerrar sesión',
  },
};

export type TranslationKey = keyof typeof translations.en;
