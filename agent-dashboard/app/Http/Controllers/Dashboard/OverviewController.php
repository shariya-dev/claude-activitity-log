<?php

namespace App\Http\Controllers\Dashboard;

use App\Http\Controllers\Controller;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\AgentHealth;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Organization overview (PRD §43): KPIs, token metrics, trend, top breakdowns,
 * recent sessions and problem agents for the selected date range (default today).
 */
class OverviewController extends Controller
{
    private const BREAKDOWN_LIMIT = 5;

    private const RECENT_SESSIONS_LIMIT = 10;

    private const PROBLEM_AGENTS_LIMIT = 10;

    /**
     * Trends have no hourly buckets, so single-day presets chart the daily trend
     * of the 14 days ending on the selected day.
     */
    private const SINGLE_DAY_TREND_DAYS = 14;

    public function __invoke(
        Request $request,
        TokenAnalytics $tokens,
        ActivityStats $activity,
        AgentHealth $health,
    ): Response {
        $range = DateRange::fromRequest($request, 'today');
        $filters = new UsageFilters($range);

        return Inertia::render('Dashboard', [
            'range' => $range->toArray(),
            'kpis' => [
                'totalDevelopers' => $activity->totalDevelopers(),
                'activeDevices' => $activity->activeDevices($range),
                'sessionsInRange' => $activity->sessionsCount($filters),
                'activeProjects' => $activity->activeProjects($range),
            ],
            'tokens' => $tokens->totals($filters),
            'trend' => $this->trend($tokens, $range),
            'topDevelopers' => $tokens->breakdown($filters, Dimension::Developer, self::BREAKDOWN_LIMIT),
            'topProjects' => $tokens->breakdown($filters, Dimension::Project, self::BREAKDOWN_LIMIT),
            'topModels' => $tokens->breakdown($filters, Dimension::Model, self::BREAKDOWN_LIMIT),
            'recentSessions' => $activity->recentSessions($filters, self::RECENT_SESSIONS_LIMIT),
            'agentHealth' => $health->summary(),
            'problemAgents' => $health->problemAgents(self::PROBLEM_AGENTS_LIMIT),
        ]);
    }

    /**
     * @return list<array{period: string, label: string, input_tokens: int, output_tokens: int, cache_creation_tokens: int, cache_read_tokens: int, actual_consumed_tokens: int, total_token_activity: int, message_count: int}>
     */
    private function trend(TokenAnalytics $tokens, DateRange $range): array
    {
        if ($range->days() > 1) {
            return $tokens->trend(new UsageFilters($range));
        }

        $window = new DateRange($range->start->subDays(self::SINGLE_DAY_TREND_DAYS - 1), $range->end, $range->preset);

        return $tokens->trend(new UsageFilters($window), Granularity::Day);
    }
}
