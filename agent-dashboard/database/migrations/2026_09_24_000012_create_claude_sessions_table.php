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
        Schema::create('claude_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('device_id')->constrained('devices')->restrictOnDelete();
            $table->foreignId('developer_id')->constrained('developers')->restrictOnDelete();
            $table->foreignId('claude_account_id')->nullable()->constrained('claude_accounts')->restrictOnDelete();
            $table->foreignId('project_id')->nullable()->constrained('projects')->restrictOnDelete();
            $table->foreignId('claude_model_id')->nullable()->constrained('claude_models')->restrictOnDelete();
            $table->string('source_session_id', 64);
            $table->timestamp('started_at');
            $table->timestamp('last_activity_at');
            $table->timestamp('ended_at')->nullable();
            $table->unsignedInteger('duration_seconds')->default(0);
            $table->unsignedInteger('activity_count')->default(0);
            $table->unsignedBigInteger('input_tokens')->default(0);
            $table->unsignedBigInteger('output_tokens')->default(0);
            $table->unsignedBigInteger('cache_creation_tokens')->default(0);
            $table->unsignedBigInteger('cache_read_tokens')->default(0);
            $table->unsignedBigInteger('actual_consumed_tokens')->default(0);
            $table->unsignedBigInteger('total_token_activity')->default(0);
            $table->string('status', 16)->default('active');
            $table->string('claude_code_version', 64)->nullable();
            $table->string('entrypoint', 64)->nullable();
            $table->string('git_branch', 191)->nullable();
            $table->timestamps();

            $table->unique(['device_id', 'source_session_id']);
            $table->index(['developer_id', 'started_at']);
            $table->index(['device_id', 'started_at']);
            $table->index(['project_id', 'started_at']);
            $table->index(['claude_account_id', 'started_at']);
            $table->index(['claude_model_id', 'started_at']);
            $table->index('started_at');
            $table->index('last_activity_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('claude_sessions');
    }
};
