import { FileSearch, Image, User } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SearchMode } from '@/types';

interface SearchModeTabsProps {
  value: SearchMode;
  onValueChange: (value: SearchMode) => void;
}

export function SearchModeTabs({ value, onValueChange }: SearchModeTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as SearchMode)} className="w-full">
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="creator" className="flex-1 sm:flex-none">
          <User />
          Creator
        </TabsTrigger>
        <TabsTrigger value="asset" className="flex-1 sm:flex-none">
          <Image />
          Title / Keyword
        </TabsTrigger>
        <TabsTrigger value="asset-id" className="flex-1 sm:flex-none">
          <FileSearch />
          Asset ID
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
