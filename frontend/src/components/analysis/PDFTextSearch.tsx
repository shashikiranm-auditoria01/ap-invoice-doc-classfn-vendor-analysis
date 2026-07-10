import { useState, useCallback, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

interface PDFTextSearchProps {
  text: string;
  onHighlightChange?: (searchTerm: string) => void;
}

interface SearchResult {
  index: number;
  context: string;
  position: number;
}

export function PDFTextSearch({ text, onHighlightChange }: PDFTextSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  // Find all occurrences of the search term
  const searchResults = useMemo((): SearchResult[] => {
    if (!searchTerm || searchTerm.length < 2 || !text) {
      return [];
    }

    const results: SearchResult[] = [];
    const lowerText = text.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    
    let position = 0;
    let index = 0;
    
    while ((position = lowerText.indexOf(lowerSearch, position)) !== -1) {
      // Get context around the match (50 chars before and after)
      const contextStart = Math.max(0, position - 50);
      const contextEnd = Math.min(text.length, position + searchTerm.length + 50);
      let context = text.slice(contextStart, contextEnd);
      
      // Add ellipsis if truncated
      if (contextStart > 0) context = '...' + context;
      if (contextEnd < text.length) context = context + '...';
      
      results.push({
        index,
        context,
        position,
      });
      
      position += 1;
      index++;
    }
    
    return results;
  }, [text, searchTerm]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setCurrentResultIndex(0);
    onHighlightChange?.(value);
  }, [onHighlightChange]);

  const goToPrevResult = useCallback(() => {
    setCurrentResultIndex(prev => 
      prev > 0 ? prev - 1 : searchResults.length - 1
    );
  }, [searchResults.length]);

  const goToNextResult = useCallback(() => {
    setCurrentResultIndex(prev => 
      prev < searchResults.length - 1 ? prev + 1 : 0
    );
  }, [searchResults.length]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setCurrentResultIndex(0);
    onHighlightChange?.('');
  }, [onHighlightChange]);

  // Highlight the search term in the context
  const highlightContext = (context: string): React.ReactNode => {
    if (!searchTerm) return context;
    
    // Escape regex metacharacters — a search term like "(USD" must not compile to an invalid
    // RegExp (which would throw during render and white-screen the panel).
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = context.split(new RegExp(`(${escaped})`, 'gi'));
    
    return parts.map((part, i) => 
      part.toLowerCase() === searchTerm.toLowerCase() ? (
        <mark key={i} className="bg-yellow-300 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={handleSearchChange}
          placeholder="Search in PDF content..."
          className="w-full pl-10 pr-24 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        
        {searchTerm && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchResults.length > 0 && (
              <>
                <span className="text-xs text-slate-500">
                  {currentResultIndex + 1}/{searchResults.length}
                </span>
                <button
                  onClick={goToPrevResult}
                  className="p-1 hover:bg-slate-100 rounded"
                  title="Previous result"
                >
                  <ChevronUp className="w-3 h-3 text-slate-500" />
                </button>
                <button
                  onClick={goToNextResult}
                  className="p-1 hover:bg-slate-100 rounded"
                  title="Next result"
                >
                  <ChevronDown className="w-3 h-3 text-slate-500" />
                </button>
              </>
            )}
            <button
              onClick={clearSearch}
              className="p-1 hover:bg-slate-100 rounded"
              title="Clear search"
            >
              <X className="w-3 h-3 text-slate-500" />
            </button>
          </div>
        )}
      </div>

      {/* Search Results */}
      {searchTerm && searchResults.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-2">
          No matches found for "{searchTerm}"
        </p>
      )}

      {searchResults.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-2">
          {searchResults.map((result, idx) => (
            <button
              key={result.index}
              onClick={() => setCurrentResultIndex(idx)}
              className={`
                w-full text-left p-2 rounded text-sm
                ${idx === currentResultIndex 
                  ? 'bg-blue-50 border border-blue-200' 
                  : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                }
              `}
            >
              <span className="text-xs text-slate-400 mb-1 block">
                Match {result.index + 1}
              </span>
              <p className="text-slate-700 line-clamp-2">
                {highlightContext(result.context)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
