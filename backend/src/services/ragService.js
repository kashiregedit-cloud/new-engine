const axios = require('axios');
const dbService = require('./dbService');
const keyService = require('./keyService');
const { supabase } = require('./dbService');

// Google's specific Embedding Model
const EMBEDDING_MODEL = "models/text-embedding-004";

// --- SQL MIGRATION HELPER (To be run manually by user) ---
/*
-- 1. Enable Extension
create extension if not exists vector;

-- 2. Create Knowledge Table
create table if not exists bot_knowledge (
  id bigint primary key generated always as identity,
  page_id text not null,
  content text not null,
  embedding vector(768), -- text-embedding-004 uses 768 dimensions
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Create Index for Speed
create index on bot_knowledge using hnsw (embedding vector_cosine_ops);

-- 4. Create Search Function (RPC)
create or replace function match_knowledge (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_page_id text
)
returns table (
  id bigint,
  content text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    bot_knowledge.id,
    bot_knowledge.content,
    1 - (bot_knowledge.embedding <=> query_embedding) as similarity
  from bot_knowledge
  where bot_knowledge.page_id = p_page_id
  and 1 - (bot_knowledge.embedding <=> query_embedding) > match_threshold
  order by bot_knowledge.embedding <=> query_embedding
  limit match_count;
end;
$$;
*/

// --- 1. GENERATE EMBEDDING (Zero Cost via Gemini) ---
async function generateEmbedding(text) {
    if (!text || !text.trim()) return null;

    // Use a smart key from our pool
    const keyObj = await keyService.getSmartKey('google', 'gemini-1.5-flash'); // Any google key works for embedding
    const apiKey = keyObj?.key || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("[RAG] No API Key available for embedding.");
        return null;
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
        const response = await axios.post(url, {
            model: EMBEDDING_MODEL,
            content: {
                parts: [{ text: text }]
            }
        });

        if (response.data && response.data.embedding && response.data.embedding.values) {
            return response.data.embedding.values; // Array of 768 floats
        }
    } catch (error) {
        console.error("[RAG] Embedding Generation Failed:", error.response?.data || error.message);
    }
    return null;
}

// --- 2. SEARCH KNOWLEDGE ---
async function searchKnowledge(query, pageId) {
    const embedding = await generateEmbedding(query);
    if (!embedding) return [];

    const { data, error } = await supabase.rpc('match_knowledge', {
        query_embedding: embedding,
        match_threshold: 0.6, // Similarity Threshold (0.0 to 1.0)
        match_count: 3,       // Top 3 chunks
        p_page_id: pageId
    });

    if (error) {
        console.error("[RAG] Search Failed:", error);
        return [];
    }
    return data || [];
}

// --- 3. INGEST (Split & Save) ---
async function ingestPrompt(pageId, fullText) {
    // Basic Chunker: Split by Markdown Headers or Paragraphs
    // Strategy: We want to chunk the "KNOWLEDGE BASE" and "FAQ" sections.
    
    // 1. Delete old knowledge for this page (Full Refresh)
    await supabase.from('bot_knowledge').delete().eq('page_id', pageId);

    // 2. Split logic
    // We split by double newlines to get paragraphs/sections
    const chunks = fullText.split(/\n\s*\n/).filter(c => c.length > 50); // Ignore tiny lines

    console.log(`[RAG] Ingesting ${chunks.length} chunks for Page ${pageId}...`);

    for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk);
        if (embedding) {
            await supabase.from('bot_knowledge').insert({
                page_id: pageId,
                content: chunk,
                embedding: embedding
            });
            // Tiny delay to respect rate limits if batching (though serial here)
            await new Promise(r => setTimeout(r, 200)); 
        }
    }
    console.log(`[RAG] Ingestion Complete for Page ${pageId}`);
}

module.exports = {
    generateEmbedding,
    searchKnowledge,
    ingestPrompt
};
