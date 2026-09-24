<?php

namespace App\Queries\Analytics;

/**
 * An axis token metrics can be broken down or filtered by.
 */
enum Dimension: string
{
    case Developer = 'developer';
    case Device = 'device';
    case Account = 'account';
    case Project = 'project';
    case Model = 'model';

    /**
     * The foreign-key column on usage_daily_rollups and claude_sessions.
     */
    public function column(): string
    {
        return match ($this) {
            self::Developer => 'developer_id',
            self::Device => 'device_id',
            self::Account => 'claude_account_id',
            self::Project => 'project_id',
            self::Model => 'claude_model_id',
        };
    }

    public function table(): string
    {
        return match ($this) {
            self::Developer => 'developers',
            self::Device => 'devices',
            self::Account => 'claude_accounts',
            self::Project => 'projects',
            self::Model => 'claude_models',
        };
    }

    /**
     * SQL expression for the display label, given the dimension table's alias.
     * Soft-deleted developers keep their label (history is never hidden).
     */
    public function labelSql(string $alias): string
    {
        return match ($this) {
            self::Developer => "CONCAT({$alias}.name, ' <', {$alias}.email, '>')",
            self::Device => "CONCAT(COALESCE({$alias}.hostname, {$alias}.device_uid), ' (', {$alias}.platform, ')')",
            self::Account => "COALESCE({$alias}.email, {$alias}.display_name, CONCAT('Account #', {$alias}.id))",
            self::Project, self::Model => "{$alias}.name",
        };
    }
}
