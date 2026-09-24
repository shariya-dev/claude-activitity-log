<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Support\BatchContext;
use App\Actions\Ingestion\Support\RecordValidator;
use App\Actions\Ingestion\Support\Upsert;
use App\Models\ClaudeAccount;
use Illuminate\Support\Facades\DB;

/**
 * Upserts validated account records on (developer_id, account_key) and links them to the device.
 */
class UpsertAccounts
{
    /**
     * @param  array<int, array<string, mixed>>  $records  validated AccountRecords
     * @return array<string, int> account_key => claude_accounts.id
     */
    public function handle(BatchContext $ctx, array $records): array
    {
        if ($records === []) {
            return [];
        }

        $developerId = $ctx->device->developer_id;
        $keys = array_values(array_unique(array_column($records, 'account_key')));
        $seen = array_flip(ClaudeAccount::query()->where('developer_id', $developerId)->whereIn('account_key', $keys)->pluck('account_key')->all());

        $rows = [];

        foreach ($records as $record) {
            $ctx->accept(isset($seen[$record['account_key']]));
            $seen[$record['account_key']] = true;
            $observedAt = RecordValidator::parseTimestamp($record['observed_at']);

            $rows[] = [
                'developer_id' => $developerId,
                'account_key' => $record['account_key'],
                'account_uuid' => $record['account_uuid'],
                'email' => $record['email'],
                'display_name' => $record['display_name'],
                'organization_uuid' => $record['organization_uuid'],
                'organization_name' => $record['organization_name'],
                'status' => 'active',
                'first_seen_at' => $observedAt,
                'last_seen_at' => $observedAt,
                'created_at' => $ctx->now,
                'updated_at' => $ctx->now,
            ];
        }

        ClaudeAccount::query()->upsert($rows, ['developer_id', 'account_key'], [
            'account_uuid' => Upsert::latestNonNull('account_uuid'),
            'email' => Upsert::latestNonNull('email'),
            'display_name' => Upsert::latestNonNull('display_name'),
            'organization_uuid' => Upsert::latestNonNull('organization_uuid'),
            'organization_name' => Upsert::latestNonNull('organization_name'),
            'first_seen_at' => Upsert::least('first_seen_at'),
            'last_seen_at' => Upsert::greatest('last_seen_at'),
            'updated_at',
        ]);

        /** @var array<string, int> $ids */
        $ids = ClaudeAccount::query()->where('developer_id', $developerId)->whereIn('account_key', $keys)->pluck('id', 'account_key')->all();

        $links = array_map(fn (array $row): array => [
            'claude_account_id' => $ids[$row['account_key']],
            'device_id' => $ctx->device->id,
            'first_seen_at' => $row['first_seen_at'],
            'last_seen_at' => $row['last_seen_at'],
            'created_at' => $ctx->now,
            'updated_at' => $ctx->now,
        ], $rows);

        DB::table('claude_account_device')->upsert($links, ['claude_account_id', 'device_id'], [
            'first_seen_at' => Upsert::least('first_seen_at'),
            'last_seen_at' => Upsert::greatest('last_seen_at'),
            'updated_at',
        ]);

        return $ids;
    }
}
