<?php

namespace App\Actions\Ingestion\Support;

use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Support\Facades\DB;

/**
 * Merge expressions for `INSERT … ON DUPLICATE KEY UPDATE` (MySQL), used as the `$update` values of `upsert()`.
 */
final class Upsert
{
    /** Keep the smaller of the stored and incoming value (a stored NULL counts as unknown). */
    public static function least(string $column): Expression
    {
        $col = self::wrap($column);

        return DB::raw("LEAST(COALESCE({$col}, ".self::incoming($column).'), '.self::incoming($column).')');
    }

    /** Keep the larger of the stored and incoming value (a stored NULL counts as unknown). */
    public static function greatest(string $column): Expression
    {
        $col = self::wrap($column);

        return DB::raw("GREATEST(COALESCE({$col}, ".self::incoming($column).'), '.self::incoming($column).')');
    }

    /** Take the incoming value unless it is NULL. */
    public static function latestNonNull(string $column): Expression
    {
        return DB::raw('COALESCE('.self::incoming($column).', '.self::wrap($column).')');
    }

    /** Add the incoming value to the stored one (counters only, never token columns). */
    public static function increment(string $column): Expression
    {
        return DB::raw(self::wrap($column).' + '.self::incoming($column));
    }

    private static function incoming(string $column): string
    {
        return DB::connection()->getConfig('use_upsert_alias')
            ? '`laravel_upsert_alias`.'.self::wrap($column)
            : 'VALUES('.self::wrap($column).')';
    }

    private static function wrap(string $column): string
    {
        return '`'.$column.'`';
    }
}
