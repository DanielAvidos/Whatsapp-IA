'use client';

import { useLanguage } from '@/context/language-provider';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'es' : 'en');
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="fixed bottom-4 left-4 flex items-center gap-2 text-muted-foreground"
      onClick={toggleLanguage}
    >
      <Globe className="h-4 w-4" />
      <span className="uppercase">{language === 'en' ? 'es' : 'en'}</span>
    </Button>
  );
}
