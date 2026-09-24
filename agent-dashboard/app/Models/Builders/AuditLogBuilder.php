<?php

namespace App\Models\Builders;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Builder;
use LogicException;

/**
 * Query builder for the append-only audit trail: inserts are allowed,
 * every Eloquent-level update/delete path throws.
 *
 * @extends Builder<AuditLog>
 */
class AuditLogBuilder extends Builder
{
    /**
     * @param  array<array-key, mixed>  $values
     */
    public function update(array $values): never
    {
        $this->appendOnly();
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @param  array<array-key, string>|string  $uniqueBy
     * @param  array<array-key, mixed>|null  $update
     */
    public function upsert(array $values, $uniqueBy, $update = null): never
    {
        $this->appendOnly();
    }

    /**
     * @param  array<array-key, mixed>  $extra
     */
    public function increment($column, $amount = 1, array $extra = []): never
    {
        $this->appendOnly();
    }

    /**
     * @param  array<array-key, mixed>  $extra
     */
    public function decrement($column, $amount = 1, array $extra = []): never
    {
        $this->appendOnly();
    }

    /**
     * @param  array<string, float|int|numeric-string>  $columns
     * @param  array<string, mixed>  $extra
     */
    public function incrementEach(array $columns, array $extra = []): never
    {
        $this->appendOnly();
    }

    /**
     * @param  array<string, float|int|numeric-string>  $columns
     * @param  array<string, mixed>  $extra
     */
    public function decrementEach(array $columns, array $extra = []): never
    {
        $this->appendOnly();
    }

    /**
     * @param  array<array-key, string>|string|null  $column
     */
    public function touch($column = null): never
    {
        $this->appendOnly();
    }

    public function delete(): never
    {
        $this->appendOnly();
    }

    public function forceDelete(): never
    {
        $this->appendOnly();
    }

    private function appendOnly(): never
    {
        throw new LogicException('Audit logs are append-only.');
    }
}
