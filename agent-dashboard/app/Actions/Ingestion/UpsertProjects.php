<?php

namespace App\Actions\Ingestion;

use App\Actions\Ingestion\Support\BatchContext;
use App\Actions\Ingestion\Support\RecordValidator;
use App\Actions\Ingestion\Support\Upsert;
use App\Models\Project;
use App\Models\ProjectLocation;

/**
 * Upserts validated project records on project_key and their per-device locations.
 */
class UpsertProjects
{
    /**
     * @param  array<int, array<string, mixed>>  $records  validated ProjectRecords
     * @return array<string, int> project_key => projects.id
     */
    public function handle(BatchContext $ctx, array $records): array
    {
        if ($records === []) {
            return [];
        }

        $keys = array_values(array_unique(array_column($records, 'project_key')));
        $seen = array_flip(Project::query()->whereIn('project_key', $keys)->pluck('project_key')->all());

        $rows = [];
        $locations = [];

        foreach ($records as $record) {
            $ctx->accept(isset($seen[$record['project_key']]));
            $seen[$record['project_key']] = true;
            $firstSeen = RecordValidator::parseTimestamp($record['first_seen_at']);
            $lastSeen = RecordValidator::parseTimestamp($record['last_seen_at']);

            $rows[] = [
                'project_key' => $record['project_key'],
                'name' => $record['name'],
                'git_remote' => $record['git_remote'],
                'first_activity_at' => $firstSeen,
                'last_activity_at' => $lastSeen,
                'created_at' => $ctx->now,
                'updated_at' => $ctx->now,
            ];

            $locations[] = [
                'project_key' => $record['project_key'],
                'path' => $record['path'],
                'path_hash' => hash('sha256', $record['path']),
                'first_seen_at' => $firstSeen,
                'last_seen_at' => $lastSeen,
            ];
        }

        Project::query()->upsert($rows, ['project_key'], [
            'name',
            'git_remote' => Upsert::latestNonNull('git_remote'),
            'first_activity_at' => Upsert::least('first_activity_at'),
            'last_activity_at' => Upsert::greatest('last_activity_at'),
            'updated_at',
        ]);

        /** @var array<string, int> $ids */
        $ids = Project::query()->whereIn('project_key', $keys)->pluck('id', 'project_key')->all();

        ProjectLocation::query()->upsert(array_map(fn (array $location): array => [
            'project_id' => $ids[$location['project_key']],
            'device_id' => $ctx->device->id,
            'path' => $location['path'],
            'path_hash' => $location['path_hash'],
            'first_seen_at' => $location['first_seen_at'],
            'last_seen_at' => $location['last_seen_at'],
            'created_at' => $ctx->now,
            'updated_at' => $ctx->now,
        ], $locations), ['project_id', 'device_id', 'path_hash'], [
            'first_seen_at' => Upsert::least('first_seen_at'),
            'last_seen_at' => Upsert::greatest('last_seen_at'),
            'updated_at',
        ]);

        foreach ($ids as $id) {
            $ctx->touchProject($id);
        }

        return $ids;
    }
}
