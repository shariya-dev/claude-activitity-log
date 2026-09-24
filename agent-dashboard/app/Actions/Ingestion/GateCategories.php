<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Support\BatchContext;
use App\Enums\TrackingCategory;

/**
 * Server-side category gating (docs/contracts/sync-api-v1.md §5), against the CURRENT tracking settings.
 *
 * Whole-record categories are rejected with `category_disabled`; field-level categories are nulled silently.
 * Rejected message records are dropped here, so prompt content never reaches storage or logs.
 */
class GateCategories
{
    /**
     * @param  array<string, mixed>  $payload
     * @return array{accounts: array<int, mixed>, projects: array<int, mixed>, sessions: array<int, mixed>, usage: array<int, mixed>, messages: array<int, mixed>}
     */
    public function handle(BatchContext $ctx, array $payload): array
    {
        $settings = $ctx->settings;
        $on = fn (TrackingCategory $category): bool => $settings->enabled($category);

        $records = [
            'accounts' => $this->recordsOf($payload, 'accounts'),
            'projects' => $this->recordsOf($payload, 'projects'),
            'sessions' => $this->recordsOf($payload, 'sessions'),
            'usage' => $this->recordsOf($payload, 'usage'),
            'messages' => $this->recordsOf($payload, 'messages'),
        ];

        $sessionOff = ! $on(TrackingCategory::Session);

        $records['accounts'] = $this->rejectAllIf(! $on(TrackingCategory::Account), $ctx, 'account', $records['accounts']);
        $records['projects'] = $this->rejectAllIf(! $on(TrackingCategory::Project), $ctx, 'project', $records['projects']);
        $records['sessions'] = $this->rejectAllIf($sessionOff, $ctx, 'session', $records['sessions']);
        $records['usage'] = $this->rejectAllIf($sessionOff || ! $on(TrackingCategory::Usage), $ctx, 'usage', $records['usage']);
        $records['messages'] = $this->rejectAllIf($sessionOff || ! $on(TrackingCategory::Prompt), $ctx, 'message', $records['messages']);

        $nullFields = static function (array $list, array $fields): array {
            foreach ($list as $index => $record) {
                if (is_array($record)) {
                    foreach ($fields as $field) {
                        if (array_key_exists($field, $record)) {
                            $list[$index][$field] = null;
                        }
                    }
                }
            }

            return $list;
        };

        $sessionFields = array_keys(array_filter([
            'project_key' => ! $on(TrackingCategory::Project),
            'account_key' => ! $on(TrackingCategory::Account),
            'model' => ! $on(TrackingCategory::Model),
            'git_branch' => ! $on(TrackingCategory::Git),
        ]));

        $records['sessions'] = $nullFields($records['sessions'], $sessionFields);

        if (! $on(TrackingCategory::Model)) {
            $records['usage'] = $nullFields($records['usage'], ['model']);
        }

        if (! $on(TrackingCategory::Git)) {
            $records['projects'] = $nullFields($records['projects'], ['git_remote']);
        }

        return $records;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<int, mixed>
     */
    private function recordsOf(array $payload, string $key): array
    {
        $records = $payload[$key] ?? [];

        return is_array($records) ? array_values($records) : [];
    }

    /**
     * @param  array<int, mixed>  $records
     * @return array<int, mixed>
     */
    private function rejectAllIf(bool $disabled, BatchContext $ctx, string $type, array $records): array
    {
        if (! $disabled) {
            return $records;
        }

        foreach ($records as $index => $record) {
            $ctx->rejectRecord($type, $record, $index, 'category_disabled');
        }

        return [];
    }
}
