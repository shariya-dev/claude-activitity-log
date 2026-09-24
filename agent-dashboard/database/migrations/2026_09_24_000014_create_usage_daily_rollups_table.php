<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('usage_daily_rollups', function (Blueprint $table) {
            $table->id();
            $table->date('date');
            $table->foreignId('developer_id')->constrained('developers')->restrictOnDelete();
            $table->foreignId('device_id')->constrained('devices')->restrictOnDelete();
            $table->foreignId('project_id')->nullable()->constrained('projects')->restrictOnDelete();
            $table->foreignId('claude_account_id')->nullable()->constrained('claude_accounts')->restrictOnDelete();
            $table->foreignId('claude_model_id')->nullable()->constrained('claude_models')->restrictOnDelete();
            $table->char('dims_hash', 64)->unique();
            $table->unsignedBigInteger('input_tokens')->default(0);
            $table->unsignedBigInteger('output_tokens')->default(0);
            $table->unsignedBigInteger('cache_creation_tokens')->default(0);
            $table->unsignedBigInteger('cache_read_tokens')->default(0);
            $table->unsignedBigInteger('actual_consumed_tokens')->default(0);
            $table->unsignedBigInteger('total_token_activity')->default(0);
            $table->unsignedInteger('message_count')->default(0);
            $table->timestamp('updated_at')->nullable();

            $table->index(['date', 'developer_id']);
            $table->index(['date', 'project_id']);
            $table->index(['date', 'claude_model_id']);
            $table->index(['date', 'claude_account_id']);
            $table->index(['date', 'device_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('usage_daily_rollups');
    }
};
