import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/Layout/MainLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { Form, FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { FilePlus, Upload, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

interface Agent {
  id: string;
  name: string;
  description: string;
  greetings: string; 
  guardrails: string;
}

const AiAgent = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [openUploadDialog, setOpenUploadDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [viewDescription, setViewDescription] = useState<{ title: string; content: string; greetings: string; guardrails: string } | null>(null);

  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      agentName: '',
      description: '',
      greetings: '',
      guardrails: ''
    }
  });

  useEffect(() => {
    const storedAgents = localStorage.getItem('agents');
    if (storedAgents) {
      try {
        const parsed = JSON.parse(storedAgents);
        if (Array.isArray(parsed)) {
          setAgents(parsed);
        }
      } catch (err) {
        console.error('Failed to parse agents from localStorage', err);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('agents', JSON.stringify(agents));
  }, [agents]);

  const filteredAgents = agents
    .filter(agent => agent.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => b.id.localeCompare(a.id));

const handleUploadAgent = async (values: { agentName: string; description: string; greetings: string; guardrails: string }) => {
  const { agentName, description, greetings, guardrails } = values;
  if (!agentName.trim() || !description.trim() || !greetings.trim() || !guardrails.trim()) {
    toast.error('Please fill all fields');
    return;
  }

  if (editingAgentId) {
    setAgents(prev =>
      prev.map(agent =>
        agent.id === editingAgentId
          ? { ...agent, name: agentName.trim(), description: description.trim(), greetings: greetings.trim(), guardrails: guardrails.trim() }
          : agent
      )
    );
    toast.success('Agent updated successfully');
  } else {
    const newAgent: Agent = {
      id: uuidv4(),
      name: agentName.trim(),
      description: description.trim(),
      greetings: greetings.trim(),
      guardrails: guardrails.trim()
    };
    setAgents(prev => [newAgent, ...prev]);
    toast.success('Agent created successfully');

    try {
    const res = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/store/agents`, newAgent);
    if (res.status === 200) {
      console.log("✅ Agent saved to backend:", res.data);
    }
    } catch (error) {
    console.error("❌ Error sending agent to backend:", error);
    toast.error("Failed to save agent to backend");
    }
  }

  form.reset();
  setEditingAgentId(null);
  setOpenUploadDialog(false);
};

  const handleDeleteAgent = (id: string) => {
    setAgents(prev => prev.filter(agent => agent.id !== id));
    toast.success('Agent deleted');
  };

  const handleClearAll = () => {
    const confirmClear = window.confirm('Are you sure you want to delete all agents?');
    if (confirmClear) {
      setAgents([]);
      toast.success('All agents cleared');
    }
  };

  return (
    <MainLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">AI Agent</h1>
        <p className="text-muted-foreground">Create and access your customized agents</p>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <Input
          placeholder="Search agent..."
          className="w-full"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <div className="flex items-center gap-2">

          <Dialog open={openUploadDialog} onOpenChange={setOpenUploadDialog}>
            <DialogTrigger asChild>
              <Button className="bg-primary flex gap-2 items-center">
                <Upload className="w-5 h-5" />
                Create Agent
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Agent</DialogTitle>
                <DialogDescription>Store agent metadata (name & description)</DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="manual">
                {/* <TabsList className="mb-4">
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                </TabsList> */}

                <TabsContent value="manual">
                  <Form {...form}>
                    <form
                      onSubmit={form.handleSubmit(handleUploadAgent)}
                      className="space-y-4"
                    >
                      <FormField
                        control={form.control}
                        name="agentName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Agent Name</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. SupportBot" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Describe this agent..." {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="greetings"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Greetings</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Hello! I'm SupportBot..." {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="guardrails"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Guardrails</FormLabel>
                            <FormControl>
                              <Textarea placeholder="What the agent must avoid / not answer..." {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Button type="submit">Create Agent</Button>
                    </form>
                  </Form>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Created Agents</h2>
          <div className="flex items-center gap-4 text-sm">
            {filteredAgents.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-red-500 hover:underline text-xs"
              >
                Clear all agents
              </button>
            )}
            <Badge variant="outline" className="bg-primary/10">
              {filteredAgents.length} {filteredAgents.length === 1 ? 'agent' : 'agents'}
            </Badge>
            
          </div>
        </div>

        <ScrollArea className="h-[60vh]">
          {filteredAgents.length > 0 ? (
            <div>
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm border border-gray-300">
                  <thead className="bg-muted text-foreground/80">
                    <tr>
                      <th className="p-3 text-center border border-gray-300 font-semibold">Agent Name</th>
                      <th className="p-3 text-center border border-gray-300 font-semibold">Description</th>
                      {/* EDIT: Added columns for Greetings & Guardrails */}
                      <th className="p-3 text-center border border-gray-300 font-semibold">Greetings</th>
                    <th className="p-3 text-center border border-gray-300 font-semibold">Guardrails</th>
                      <th className="p-3 text-center border border-gray-300 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgents.map((agent) => (
                      <tr
                        key={agent.id}
                        className="border-t border-border hover:bg-accent/40 transition-all"
                      >
                        <td
                          className="p-3 text-center border border-gray-300 text-blue-600 hover:underline cursor-pointer"
                          onClick={() => navigate(`/resource-base/${agent.name}`)}
                        >
                          {agent.name}
                        </td>
                        <td className="p-3 text-center text-muted-foreground border border-gray-300">
                          {expandedId === agent.id ? (
                            <>
                              <div className="whitespace-pre-wrap">{agent.description}</div>
                              <button
                                onClick={() => setExpandedId(null)}
                                className="text-blue-500 underline text-xs mt-1"
                              >
                                Show less
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="truncate max-w-sm mx-auto">{agent.description}</div>
                              {agent.description.length > 80 && (
                                <button
                                  className="text-blue-500 underline text-xs mt-1"
                                  onClick={() =>
                                    setViewDescription({ title: agent.name, content: agent.description, greetings: agent.greetings, guardrails: agent.guardrails })
                                  }
                                >
                                  Read more
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        {/* EDIT: show greetings (truncated) */}
                        <td className="p-3 text-center text-muted-foreground border border-gray-300">
                          <div className="truncate max-w-xs">{agent.greetings}</div>
                          {agent.greetings && agent.greetings.length > 60 && (
                            <button
                              className="text-blue-500 underline text-xs mt-1"
                              onClick={() => setViewDescription({ title: agent.name, content: agent.description, greetings: agent.greetings, guardrails: agent.guardrails })}
                            >
                              Read more
                            </button>
                          )}
                        </td>
                        <td className="p-3 text-center text-muted-foreground border border-gray-300">
                          <div className="truncate max-w-xs">{agent.guardrails}</div>
                          {agent.guardrails && agent.guardrails.length > 60 && (
                            <button
                              className="text-blue-500 underline text-xs mt-1"
                              onClick={() => setViewDescription({ title: agent.name, content: agent.description, greetings: agent.greetings, guardrails: agent.guardrails })}
                            >
                              Read more
                            </button>
                          )}
                        </td>
                        <td className="p-3 text-center align-middle">
                          <div className="flex items-center justify-center gap-5">
                            <button
                              className="text-sm hover:underline"
                              onClick={() => {
                                form.setValue('agentName', agent.name);
                                form.setValue('description', agent.description);
                                form.setValue('greetings', agent.greetings);
                                form.setValue('guardrails', agent.guardrails);
                                setEditingAgentId(agent.id);
                                setOpenUploadDialog(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteAgent(agent.id)}
                              className="text-red-500 text-sm hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="md:hidden space-y-4">
                {filteredAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="border border-gray-300 rounded-md p-4 bg-white shadow hover:shadow-md transition-all"
                  >
                    <div
                      onClick={() => navigate(`/resource-base/${agent.name}`)}
                      className="text-base font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      {agent.name}
                    </div>
                    <div className="text-sm text-muted-foreground mt-2">
                      {expandedId === agent.id ? (
                        <>
                          <div className="whitespace-pre-wrap">{agent.description}</div>
                          <button
                            onClick={() => setExpandedId(null)}
                            className="text-blue-500 underline text-xs mt-1"
                          >
                            Show less
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="truncate">{agent.description}</div>
                          {agent.description.length > 80 && (
                            <button
                              className="text-blue-500 underline text-xs mt-1"
                              onClick={() =>
                                setViewDescription({ title: agent.name, content: agent.description, greetings: agent.greetings, guardrails: agent.guardrails })
                              }
                            >
                              Read more
                            </button>
                          )}
                        </>
                      )}
                      {/* EDIT: show brief greetings & guardrails in mobile card */}
                      {agent.greetings && (
                        <div className="mt-2">
                        <strong className="text-xs text-foreground">Greetings</strong>
                        <div className="truncate">{agent.greetings}</div>
                        </div>
                      )}
                      {agent.guardrails && (
                      <div className="mt-2">
                      <strong className="text-xs text-foreground">Guardrails</strong>
                      <div className="truncate">{agent.guardrails}</div>
                      </div>
                      )}
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => {
                          form.setValue('agentName', agent.name);
                          form.setValue('description', agent.description);  
                          form.setValue('greetings', agent.greetings);
                          form.setValue('guardrails', agent.guardrails);
                          setEditingAgentId(agent.id);
                          setOpenUploadDialog(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="text-xs"
                        onClick={() => handleDeleteAgent(agent.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <FilePlus className="mx-auto h-12 w-12 text-muted-foreground/60" />
              <h3 className="mt-4 text-lg font-medium">No agents yet</h3>
              <p className="text-muted-foreground mt-2">
                {searchQuery
                  ? 'No agents match your search'
                  : 'Create agents to start building your assistant system'}
              </p>
            </div>
          )}

        </ScrollArea>
      </div>

      {viewDescription && (
        <Dialog open onOpenChange={() => setViewDescription(null)}>
          <DialogContent
            className="w-full max-w-3xl max-h-[80vh] overflow-y-auto px-6 py-4"
          >
            <DialogHeader>
              <DialogTitle className="text-xl break-words">
                Agent  : {viewDescription.title}
              </DialogTitle>
            </DialogHeader>

            <div className="mt-4">
              <h3 className="text-md font-semibold text-foreground mb-1">Description</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                {viewDescription.content}
              </p>
            </div>
            <div className="mt-4">
              <h3 className="text-md font-semibold text-foreground mb-1">Greetings</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                {viewDescription.greetings}
              </p>
            </div>      
            <div className="mt-4">
              <h3 className="text-md font-semibold text-foreground mb-1">Guardrails</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                {viewDescription.guardrails}
              </p>
            </div>        
          </DialogContent>
        </Dialog>
      )}

    </MainLayout>
  );
};

export default AiAgent;