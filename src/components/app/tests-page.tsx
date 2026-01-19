"use client";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/context/language-provider";
import { Loader2, RefreshCw } from "lucide-react";

// A placeholder SVG for a QR code
const QrCodeSvg = () => (
    <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <path fill="currentColor" d="M128 0h32v32h-32zM96 32h32v32H96zM32 64H0v32h32zm224 0h-32v32h32zM64 96h32v32H64zm128 0h32v32h-32zM32 128H0v32h32zm224 0h-32v32h32zM96 160h32v32H96zM64 192h32v32H64zM0 224h32v32H0zm128 0h32v32h-32z" />
        <path fill="currentColor" d="M0 0h96v96H0zm32 32v32h32V32z" />
        <path fill="currentColor" d="M160 0h96v96h-96zm32 32v32h32V32z" />
        <path fill="currentColor" d="M0 160h96v96H0zm32 32v32h32v-32z" />
        <path fill="currentColor" d="M224 96h32v32h-32zM96 96h32v32H96zM160 96h32v32h-32zm-32 32h32v32h-32zm32 0h32v32h-32zm-64 32h32v32h-32zm32 0h32v32h-32zm-32 32h32v32h-32zm-32 32H32v32h32zm96-32h32v32h-32zm-32 32h32v32h-32zm32 0h32v32h-32zm32 0h32v32h-32z" />
    </svg>
);


export function TestsPage() {
    const { t } = useLanguage();

    return (
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
            <PageHeader
                title={t('linked.device')}
                description={t('manage.connection')}
            />

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>{t('connection.status')}</CardTitle>
                        <CardDescription>{t('link.device.description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                <span className="font-medium">{t('main.channel')}</span>
                            </div>
                            <Button variant="outline">{t('scan.qr.code')}</Button>
                        </div>
                        <Button variant="outline" className="w-full">
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {t('force.relink')}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6 flex flex-col items-center justify-center gap-4 h-full">
                        <div className="w-64 h-64">
                            <QrCodeSvg />
                        </div>
                        <p className="text-center text-sm text-muted-foreground">
                            {t('scan.qr.instruction')}
                        </p>
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}
