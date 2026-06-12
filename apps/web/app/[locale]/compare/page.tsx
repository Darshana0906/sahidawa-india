"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Plus, ShieldCheck, X } from "lucide-react";
import { Link } from "@/i18n/routing";
import { PageHeader } from "../components/PageHeader";
import ComparisonGrid, {
    type ComparisonGridLabels,
    type Medicine,
} from "@/src/components/ComparisonGrid";
import MedicineSearchSelect from "@/src/components/MedicineSearchSelect";
import { COMPARE_SELECT_FIELDS } from "@/src/lib/compareSelectFields";
import { supabase } from "@/lib/supabase";
import { mapMedicineRow } from "@/src/lib/mapMedicineRow";
import { API_BASE } from "@/lib/api";

type InteractionSeverity = "High Risk" | "Moderate" | "Safe";

type InteractionWarning = {
    medicineAId: string;
    medicineBId: string;
    drugA: string;
    drugB: string;
    severity: InteractionSeverity;
    sideEffects?: string;
    description?: string;
    precautions?: string;
    source?: string;
};

async function searchMedicines(query: string): Promise<Medicine[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    const pattern = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const { data, error } = await supabase
        .from("medicines")
        .select(COMPARE_SELECT_FIELDS)
        .or(`brand_name.ilike."${pattern}",generic_name.ilike."${pattern}"`)
        .limit(25);

    if (error) {
        console.error(error.message);
        return [];
    }
    return ((data ?? []) as Record<string, unknown>[]).map((row) => mapMedicineRow(row));
}

export default function ComparePage() {
    const t = useTranslations("Compare");
    const [selectedMedicines, setSelectedMedicines] = useState<(Medicine | null)[]>([null, null]);
    const [interactions, setInteractions] = useState<InteractionWarning[]>([]);
    const [interactionsLoading, setInteractionsLoading] = useState(false);
    const [interactionsError, setInteractionsError] = useState<string | null>(null);

    const medicine1 = selectedMedicines[0] ?? null;
    const medicine2 = selectedMedicines[1] ?? null;
    const selectedIds = selectedMedicines
        .filter((medicine): medicine is Medicine => medicine != null)
        .map((medicine) => medicine.id);
    const selectedIdsKey = selectedIds.join(",");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        const ids = Array.from(new Set([params.get("m1"), params.get("m2"), params.get("m3")]))
            .filter((id): id is string => Boolean(id))
            .slice(0, 6);

        if (ids.length < 2) return;

        const loadMedicines = async () => {
            const { data, error } = await supabase
                .from("medicines")
                .select(COMPARE_SELECT_FIELDS)
                .in("id", ids);

            if (error || !data) return;

            const medicines: Medicine[] = (data as Record<string, unknown>[]).map((row) =>
                mapMedicineRow(row)
            );
            const medicinesById = new Map<string, Medicine>(
                medicines.map((medicine) => [medicine.id, medicine])
            );
            const loaded: Array<Medicine | null> = ids.map((id) => medicinesById.get(id) ?? null);

            setSelectedMedicines(loaded.length >= 2 ? loaded : [loaded[0] ?? null, null]);
        };

        loadMedicines();
    }, []);

    useEffect(() => {
        if (selectedIds.length < 2) {
            setInteractions([]);
            setInteractionsError(null);
            setInteractionsLoading(false);
            return;
        }

        const controller = new AbortController();
        const params = new URLSearchParams({ ids: selectedIdsKey });

        setInteractionsLoading(true);
        setInteractionsError(null);

        fetch(`${API_BASE}/api/v1/interactions?${params.toString()}`, {
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    const body = (await response.json().catch(() => ({}))) as { error?: string };
                    throw new Error(body.error ?? "Unable to check medicine interactions.");
                }

                return response.json() as Promise<{ interactions: InteractionWarning[] }>;
            })
            .then((body) => {
                const severityOrder: Record<InteractionSeverity, number> = {
                    "High Risk": 0,
                    Moderate: 1,
                    Safe: 2,
                };

                setInteractions(
                    [...(body.interactions ?? [])].sort(
                        (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
                    )
                );
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                setInteractions([]);
                setInteractionsError(
                    error instanceof Error
                        ? error.message
                        : "Unable to check medicine interactions."
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setInteractionsLoading(false);
                }
            });

        return () => controller.abort();
    }, [selectedIds.length, selectedIdsKey]);

    const handleSearch = useCallback((q: string) => searchMedicines(q), []);

    const updateSelectedMedicine = (index: number, medicine: Medicine | null) => {
        setSelectedMedicines((current) => {
            const next = [...current];
            next[index] = medicine;
            return next;
        });
    };

    const addMedicineSlot = () => {
        setSelectedMedicines((current) => (current.length >= 6 ? current : [...current, null]));
    };

    const removeMedicineSlot = (index: number) => {
        setSelectedMedicines((current) =>
            current.filter((_, currentIndex) => currentIndex !== index)
        );
    };

    const comparisonLabels: ComparisonGridLabels = {
        emptyComparison: t("emptyComparison"),
        fieldHeader: t("fieldHeader"),
        medicineA: t("medicineA"),
        medicineB: t("medicineB"),
        priceUnavailable: t("priceUnavailable"),
        noSavings: t("noSavings"),
        saveAmount: (amount, percent) => t("saveAmount", { amount, percent }),
        rows: {
            brandName: t("rows.brandName"),
            genericName: t("rows.genericName"),
            composition: t("rows.composition"),
            manufacturer: t("rows.manufacturer"),
            type: t("rows.type"),
            cdscoStatus: t("rows.cdscoStatus"),
            expiryDate: t("rows.expiryDate"),
            marketPrice: t("rows.marketPrice"),
            janAushadhiPrice: t("rows.janAushadhiPrice"),
            savings: t("rows.savings"),
        },
        medicineTypes: {
            brand: t("medicineTypes.brand"),
            generic: t("medicineTypes.generic"),
        },
        status: {
            approved: t("status.approved"),
            recalled: t("status.recalled"),
            banned: t("status.banned"),
        },
    };

    const severityClass = (severity: InteractionSeverity) => {
        switch (severity) {
            case "High Risk":
                return "border-red-200 bg-red-50 text-red-700";
            case "Moderate":
                return "border-amber-200 bg-amber-50 text-amber-800";
            case "Safe":
                return "border-emerald-200 bg-emerald-50 text-emerald-700";
        }
    };

    return (
        <div className="min-h-screen bg-(--color-surface-muted) text-(--color-text-primary)">
            <div className="print:hidden">
                <PageHeader
                    title={t("pageTitle")}
                    subtitle={t("pageSubtitle")}
                    backHref="/"
                    variant="light"
                />
            </div>
            <div className="mb-6 hidden text-center print:block">
                <h1 className="text-2xl font-bold">{t("reportTitle")}</h1>

                <p className="text-sm">
                    {t("generatedOn", { date: new Date().toLocaleDateString() })}
                </p>
            </div>
            <main className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
                <section className="rounded-xl border border-(--color-border-muted) bg-(--color-surface-page) p-5 transition-all duration-300 hover:border-emerald-500/20 hover:shadow-md print:hidden">
                    <div className="grid gap-4 sm:grid-cols-2">
                        {selectedMedicines.map((medicine, index) => (
                            <div key={index} className="relative">
                                <MedicineSearchSelect
                                    label={
                                        index === 0
                                            ? t("firstMedicine")
                                            : index === 1
                                              ? t("secondMedicine")
                                              : `Medicine ${index + 1}`
                                    }
                                    value={medicine}
                                    onChange={(nextMedicine) =>
                                        updateSelectedMedicine(index, nextMedicine)
                                    }
                                    onSearch={handleSearch}
                                    placeholder={t("searchPlaceholder")}
                                />
                                {index > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeMedicineSlot(index)}
                                        className="absolute top-0 right-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                        aria-label={`Remove medicine ${index + 1}`}
                                    >
                                        <X size={15} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={addMedicineSlot}
                        disabled={selectedMedicines.length >= 6}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus size={16} />
                        Add medicine
                    </button>
                </section>
                {medicine1 && medicine2 && (
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 print:hidden"
                        >
                            {t("printExport")}
                        </button>
                    </div>
                )}
                <ComparisonGrid
                    medicine1={medicine1}
                    medicine2={medicine2}
                    labels={comparisonLabels}
                />
                {selectedIds.length >= 2 && (
                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">
                                    Interaction warnings
                                </h2>
                                <p className="text-sm text-slate-500">
                                    Warnings are based on all selected medicines.
                                </p>
                            </div>
                            {interactionsLoading ? (
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                    Checking
                                </span>
                            ) : (
                                <ShieldCheck className="mt-1 text-emerald-600" size={22} />
                            )}
                        </div>

                        {interactionsError ? (
                            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                {interactionsError}
                            </div>
                        ) : interactions.length === 0 && !interactionsLoading ? (
                            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                                No interactions found.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {interactions.map((interaction) => (
                                    <article
                                        key={`${interaction.medicineAId}-${interaction.medicineBId}`}
                                        className="rounded-lg border border-slate-200 p-4"
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="font-semibold text-slate-900">
                                                {interaction.drugA} + {interaction.drugB}
                                            </h3>
                                            <span
                                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${severityClass(
                                                    interaction.severity
                                                )}`}
                                            >
                                                {interaction.severity}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm text-slate-700">
                                            {interaction.sideEffects || interaction.description}
                                        </p>
                                        {interaction.precautions && (
                                            <p className="mt-2 text-sm font-medium text-slate-800">
                                                {interaction.precautions}
                                            </p>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                )}
                <p className="text-center text-sm text-(--color-text-secondary) print:hidden">
                    <Link
                        href="/map"
                        className="text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                        {t("findPharmacies")}
                    </Link>
                </p>
            </main>
        </div>
    );
}
