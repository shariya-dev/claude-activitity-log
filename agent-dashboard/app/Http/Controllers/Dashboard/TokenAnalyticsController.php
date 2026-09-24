<?php

namespace App\Http\Controllers\Dashboard;

use App\Http\Controllers\Controller;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\FilterOptions;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Token analytics explorer (PRD §19–22): every dimension filter, granularity and group-by.
 * Invalid query parameters fall back to their defaults instead of failing the page.
 */
class TokenAnalyticsController extends Controller
{
    public const BREAKDOWN_LIMIT = 25;

    public const METRICS = ['total', 'actual', 'cache_read', 'input', 'output', 'cache_creation'];

    public function __invoke(Request $request, TokenAnalytics $analytics, FilterOptions $options): Response
    {
        [$filters, $rangeFallback] = $this->filters($request);
        $explicit = Granularity::tryFrom($this->param($request, 'granularity'));
        $granularity = $explicit ?? Granularity::auto($filters->range);
        $group = Dimension::tryFrom($this->param($request, 'group')) ?? Dimension::Developer;
        $metric = $this->param($request, 'metric');
        $metric = in_array($metric, self::METRICS, true) ? $metric : self::METRICS[0];
        // One extra row tells whether the breakdown was cut at the limit.
        $breakdown = $analytics->breakdown($filters, $group, self::BREAKDOWN_LIMIT + 1);

        return Inertia::render('Analytics/Tokens', [
            'range' => $filters->range->toArray(),
            'rangeFallback' => $rangeFallback,
            'filters' => [
                'developer' => $filters->developerId,
                'device' => $filters->deviceId,
                'account' => $filters->accountId,
                'project' => $filters->projectId,
                'model' => $filters->modelId,
            ],
            'options' => $options->for(Dimension::cases()),
            'granularity' => ['value' => $granularity->value, 'auto' => $explicit === null],
            'group' => $group->value,
            'metric' => $metric,
            'totals' => $analytics->totals($filters),
            'trend' => $analytics->trend($filters, $granularity),
            'breakdown' => array_slice($breakdown, 0, self::BREAKDOWN_LIMIT),
            'breakdownLimit' => self::BREAKDOWN_LIMIT,
            'breakdownTruncated' => count($breakdown) > self::BREAKDOWN_LIMIT,
        ]);
    }

    /**
     * An invalid custom date range falls back to the default preset, keeping the dimension filters.
     *
     * @return array{UsageFilters, bool} the filters and whether the date range fell back
     */
    private function filters(Request $request): array
    {
        try {
            return [UsageFilters::fromRequest($request), false];
        } catch (ValidationException) {
            return [UsageFilters::fromRequest($request->duplicate($request->except(['range', 'from', 'to']))), true];
        }
    }

    private function param(Request $request, string $key): string
    {
        $value = $request->query($key);

        return is_string($value) ? $value : '';
    }
}
