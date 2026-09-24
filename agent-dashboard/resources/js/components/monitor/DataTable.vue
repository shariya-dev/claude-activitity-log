<script setup lang="ts" generic="T extends Record<string, unknown>">
import { Link, router, usePage } from '@inertiajs/vue3';
import { ArrowDown, ArrowUp, ArrowUpDown } from '@lucide/vue';
import EmptyState from '@/components/monitor/EmptyState.vue';
import { cn } from '@/lib/utils';
import type {
    DataTableColumn,
    Paginated,
    PaginatorLink,
    SortDirection,
} from '@/types/monitor';

type Props = {
    paginator: Paginated<T>;
    columns: DataTableColumn[];
    sort?: string;
    direction?: SortDirection;
    only?: string[];
    rowKey?: string;
};

const props = withDefaults(defineProps<Props>(), {
    sort: undefined,
    direction: 'desc',
    only: undefined,
    rowKey: 'id',
});

defineSlots<
    {
        [key: `cell-${string}`]: (props: { row: T; value: unknown }) => unknown;
    } & {
        empty?: () => unknown;
    }
>();

const page = usePage();

function ariaSort(
    column: DataTableColumn,
): 'ascending' | 'descending' | 'none' | undefined {
    if (!column.sortable) {
        return undefined;
    }

    if (props.sort !== column.key) {
        return 'none';
    }

    return props.direction === 'asc' ? 'ascending' : 'descending';
}

function sortBy(column: DataTableColumn): void {
    const nextDirection: SortDirection =
        props.sort === column.key && props.direction === 'desc'
            ? 'asc'
            : 'desc';
    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const url = new URL(page.url, origin);
    const query: Record<string, string> = Object.fromEntries(
        url.searchParams.entries(),
    );
    delete query.page;

    router.get(
        url.pathname,
        { ...query, sort: column.key, dir: nextDirection },
        {
            preserveState: true,
            preserveScroll: true,
            replace: true,
            ...(props.only ? { only: props.only } : {}),
        },
    );
}

function pageHref(link: PaginatorLink): string | null {
    if (!link.url) {
        return null;
    }

    const origin =
        typeof window !== 'undefined'
            ? window.location.origin
            : 'http://localhost';
    const target = new URL(link.url, origin).searchParams.get('page');

    if (target === null) {
        return link.url;
    }

    const url = new URL(page.url, origin);
    url.searchParams.set('page', target);

    return `${url.pathname}?${url.searchParams.toString()}`;
}

function rowIdentity(row: T, index: number): string | number {
    const value = row[props.rowKey];

    return typeof value === 'string' || typeof value === 'number'
        ? value
        : index;
}

function displayValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value as string | number | boolean);
}

function linkLabel(link: PaginatorLink): string {
    const decoded = link.label
        .replace(/&laquo;|&raquo;|&hellip;/g, (entity) =>
            entity === '&hellip;' ? '…' : '',
        )
        .replace(/&amp;/g, '&')
        .trim();

    if (/previous/i.test(decoded)) {
        return 'Previous';
    }

    if (/next/i.test(decoded)) {
        return 'Next';
    }

    return decoded;
}

function linkAriaLabel(link: PaginatorLink): string | undefined {
    const label = linkLabel(link);

    if (label === 'Previous') {
        return 'Previous page';
    }

    if (label === 'Next') {
        return 'Next page';
    }

    return /^\d+$/.test(label) ? `Page ${label}` : undefined;
}

const alignClass = (column: DataTableColumn): string =>
    column.align === 'right' ? 'text-right' : 'text-left';
</script>

<template>
    <div class="flex flex-col gap-3">
        <template v-if="paginator.data.length === 0">
            <slot name="empty">
                <EmptyState />
            </slot>
        </template>
        <div v-else class="overflow-x-auto rounded-lg border">
            <table class="w-full text-sm">
                <thead class="bg-muted/50 text-muted-foreground">
                    <tr class="border-b">
                        <th
                            v-for="column in columns"
                            :key="column.key"
                            scope="col"
                            :aria-sort="ariaSort(column)"
                            :class="
                                cn(
                                    'px-4 py-2.5 font-medium whitespace-nowrap',
                                    alignClass(column),
                                    column.class,
                                )
                            "
                        >
                            <button
                                v-if="column.sortable"
                                type="button"
                                :class="
                                    cn(
                                        'inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                        column.align === 'right'
                                            ? 'flex-row-reverse'
                                            : '',
                                    )
                                "
                                @click="sortBy(column)"
                            >
                                <span>{{ column.label }}</span>
                                <ArrowUp
                                    v-if="
                                        sort === column.key &&
                                        direction === 'asc'
                                    "
                                    class="size-3.5"
                                    aria-hidden="true"
                                />
                                <ArrowDown
                                    v-else-if="sort === column.key"
                                    class="size-3.5"
                                    aria-hidden="true"
                                />
                                <ArrowUpDown
                                    v-else
                                    class="size-3.5 opacity-50"
                                    aria-hidden="true"
                                />
                            </button>
                            <span v-else>{{ column.label }}</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(row, index) in paginator.data"
                        :key="rowIdentity(row, index)"
                        class="border-b last:border-b-0 hover:bg-muted/30"
                    >
                        <td
                            v-for="column in columns"
                            :key="column.key"
                            :class="
                                cn(
                                    'px-4 py-2.5',
                                    alignClass(column),
                                    column.class,
                                )
                            "
                        >
                            <slot
                                :name="`cell-${column.key}`"
                                :row="row"
                                :value="row[column.key]"
                            >
                                {{ displayValue(row[column.key]) }}
                            </slot>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <nav
            v-if="paginator.total > 0"
            aria-label="Pagination"
            class="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
        >
            <p>
                Showing {{ paginator.from ?? 0 }}–{{ paginator.to ?? 0 }} of
                {{ paginator.total }}
            </p>
            <ul
                v-if="paginator.last_page > 1"
                class="flex flex-wrap items-center gap-1"
            >
                <li v-for="(link, index) in paginator.links" :key="index">
                    <Link
                        v-if="link.url && !link.active"
                        :href="pageHref(link) ?? link.url"
                        preserve-scroll
                        preserve-state
                        :only="only"
                        :aria-label="linkAriaLabel(link)"
                        class="inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2.5 text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {{ linkLabel(link) }}
                    </Link>
                    <span
                        v-else
                        :aria-current="link.active ? 'page' : undefined"
                        :aria-disabled="link.active ? undefined : 'true'"
                        :class="
                            cn(
                                'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2.5',
                                link.active
                                    ? 'bg-primary text-primary-foreground'
                                    : 'opacity-50',
                            )
                        "
                    >
                        {{ linkLabel(link) }}
                    </span>
                </li>
            </ul>
        </nav>
    </div>
</template>
