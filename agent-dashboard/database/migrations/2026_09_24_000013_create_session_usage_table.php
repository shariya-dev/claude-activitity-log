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
        Schema::create('session_usage', function (Blueprint $table) {
            $table->id();
            $table->foreignId('claude_session_id')->constrained('claude_sessions')->restrictOnDelete();
            $table->string('source_message_id', 64);
            $table->string('request_id', 64)->nullable();
            $table->boolean('is_sidechain')->default(false);
            $table->foreignId('claude_model_id')->nullable()->constrained('claude_models')->restrictOnDelete();
            $table->foreignId('device_id')->constrained('devices')->restrictOnDelete();
            $table->foreignId('developer_id')->constrained('developers')->restrictOnDelete();
            $table->foreignId('project_id')->nullable()->constrained('projects')->restrictOnDelete();
            $table->foreignId('claude_account_id')->nullable()->constrained('claude_accounts')->restrictOnDelete();
            $table->unsignedBigInteger('input_tokens')->default(0);
            $table->unsignedBigInteger('output_tokens')->default(0);
            $table->unsignedBigInteger('cache_creation_tokens')->default(0);
            $table->unsignedBigInteger('cache_read_tokens')->default(0);
            $table->unsignedBigInteger('actual_consumed_tokens')->default(0);
            $table->unsignedBigInteger('total_token_activity')->default(0);
            $table->timestamp('recorded_at', 3);
            $table->date('recorded_on');
            $table->timestamps();

            $table->unique(['claude_session_id', 'source_message_id'], 'session_usage_session_message_unique');
            $table->index(['recorded_on', 'device_id']);
            $table->index(['claude_session_id', 'recorded_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('session_usage');
    }
};
