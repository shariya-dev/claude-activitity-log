<?php

namespace App\Queries\Analytics;

use Illuminate\Support\Facades\DB;

/**
 * Select options for the dashboard filter bar. One query per requested dimension.
 * Includes soft-deleted developers and inactive records: history stays filterable.
 */
final class FilterOptions
{
    /**
     * @param  list<Dimension>  $dims
     * @return array<string, list<array{id: int, label: string}>>
     */
    public function for(array $dims): array
    {
        $options = [];

        foreach ($dims as $dimension) {
            if (array_key_exists($dimension->value, $options)) {
                continue;
            }

            $options[$dimension->value] = DB::table($dimension->table().' as d')
                ->selectRaw('d.id as id, '.$dimension->labelSql('d').' as label')
                ->orderBy('label')
                ->orderBy('d.id')
                ->get()
                ->map(fn (object $row): array => ['id' => (int) $row->id, 'label' => (string) $row->label])
                ->values()
                ->all();
        }

        return $options;
    }
}
